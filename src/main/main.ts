import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'node:path'
import { getSettings, saveSettings, clearSettings, sanitizeSettings } from './settings'
import {
  testConnection,
  listCustomers,
  createCustomer,
  listCustomerOrders,
  listOrders,
  listOrderNotes,
  createOrderNote,
  updateOrderStatus,
  listProducts,
  getProductDetail,
  updateProductVariation,
  updateProduct,
  createProduct,
  listProductOrders,
  getStoreStats,
} from './woo'
import type {
  CustomerPayload,
  ListCustomersQuery,
  ListOrdersQuery,
  ListProductsQuery,
  OrderNotePayload,
  PrintBulkDoc,
  PrintReceiptDoc,
  ProductPatch,
  ProductPayload,
  Settings,
  VariationPatch,
} from '../shared/types'

app.setName('WooCommerce-Dashboard')

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#080d19',
    autoHideMenuBar: true,
    title: 'داشبورد ووکامرس',
    icon: path.join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  win.once('ready-to-show', () => win.show())

  // Open external links (target=_blank / window.open) in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(path.join(__dirname, '../../dist/index.html'))
  }
}

type PrintableDoc = Pick<PrintReceiptDoc, 'widthMm' | 'landscape' | 'html'>

/**
 * Load a print document in a hidden window and open the system print dialog.
 * Windows opens the native print dialog only when the printing window is
 * visible, focused and settled. NOTE: the PROMISE form of webContents.print
 * resolves instantly WITHOUT opening the dialog on Windows (Electron 37), so
 * the callback form must be used — it fires only after the dialog closes.
 */
async function printViaDialog(doc: PrintableDoc): Promise<{ ok: boolean }> {
  const win = new BrowserWindow({
    show: false,
    width: Math.max(560, Math.min(1200, Math.round((doc.widthMm || 100) * 3.9))),
    height: 640,
    autoHideMenuBar: true,
    title: 'چاپ رسید',
    backgroundColor: '#ffffff',
    webPreferences: { sandbox: true },
  })
  const payload = 'data:text/html;charset=utf-8,' + encodeURIComponent(doc.html)
  try {
    await win.loadURL(payload)
    win.show()
    win.focus()
    // Give the window manager + layout a moment before opening the dialog.
    await new Promise((r) => setTimeout(r, 600))
    const ok = await new Promise<boolean>((resolve) => {
      win.webContents.print(
        {
          silent: false,
          printBackground: true,
          landscape: !!doc.landscape,
          margins: { marginType: 'none' },
        },
        (success) => resolve(success),
      )
    })
    return { ok }
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

function registerIpc(): void {
  ipcMain.handle('settings:get', () => getSettings())

  ipcMain.handle('settings:save', (_event, raw: Settings) => {
    const settings = sanitizeSettings(raw)
    saveSettings(settings)
    return { ok: true }
  })

  ipcMain.handle('settings:clear', () => {
    clearSettings()
    return { ok: true }
  })

  ipcMain.handle('wc:test', async (_event, override?: Settings) => {
    const cfg = override && override.siteUrl && override.consumerKey && override.consumerSecret
      ? sanitizeSettings(override)
      : getSettings()
    if (!cfg.siteUrl || !cfg.consumerKey || !cfg.consumerSecret) {
      return { ok: false, message: 'ابتدا آدرس سایت و کلیدهای API را در تنظیمات وارد کنید.' }
    }
    try {
      const result = await testConnection(cfg)
      return {
        ok: true,
        message: 'اتصال برقرار شد — ' + result.totalCustomers.toLocaleString('fa-IR') + ' مشتری در فروشگاه موجود است.',
      }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('wc:customers', async (_event, query: ListCustomersQuery) => {
    const cfg = getSettings()
    if (!cfg.siteUrl || !cfg.consumerKey || !cfg.consumerSecret) {
      throw new Error('تنظیمات API کامل نشده است.')
    }
    try {
      return await listCustomers(cfg, query ?? {})
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle('wc:create-customer', async (_event, payload: CustomerPayload) => {
    const cfg = getSettings()
    if (!cfg.siteUrl || !cfg.consumerKey || !cfg.consumerSecret) {
      throw new Error('تنظیمات API کامل نشده است.')
    }
    try {
      return await createCustomer(cfg, payload ?? {})
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle('wc:store-stats', async () => {
    const cfg = getSettings()
    if (!cfg.siteUrl || !cfg.consumerKey || !cfg.consumerSecret) {
      throw new Error('تنظیمات API کامل نشده است.')
    }
    try {
      return await getStoreStats(cfg)
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle('wc:products', async (_event, query: ListProductsQuery) => {
    const cfg = getSettings()
    if (!cfg.siteUrl || !cfg.consumerKey || !cfg.consumerSecret) {
      throw new Error('تنظیمات API کامل نشده است.')
    }
    try {
      return await listProducts(cfg, query ?? {})
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle('wc:customer-orders', async (_event, customerId: number) => {
    const cfg = getSettings()
    if (!cfg.siteUrl || !cfg.consumerKey || !cfg.consumerSecret) {
      throw new Error('تنظیمات API کامل نشده است.')
    }
    try {
      return await listCustomerOrders(cfg, customerId)
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle('wc:orders', async (_event, query: ListOrdersQuery) => {
    const cfg = getSettings()
    if (!cfg.siteUrl || !cfg.consumerKey || !cfg.consumerSecret) {
      throw new Error('تنظیمات API کامل نشده است.')
    }
    try {
      return await listOrders(cfg, query ?? {})
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle('wc:order-notes', async (_event, orderId: number) => {
    const cfg = getSettings()
    if (!cfg.siteUrl || !cfg.consumerKey || !cfg.consumerSecret) {
      throw new Error('تنظیمات API کامل نشده است.')
    }
    try {
      return await listOrderNotes(cfg, orderId)
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle('wc:order-note-create', async (_event, orderId: number, payload: OrderNotePayload) => {
    const cfg = getSettings()
    if (!cfg.siteUrl || !cfg.consumerKey || !cfg.consumerSecret) {
      throw new Error('تنظیمات API کامل نشده است.')
    }
    try {
      return await createOrderNote(cfg, orderId, payload ?? {})
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle('wc:order-status', async (_event, orderId: number, status: string) => {
    const cfg = getSettings()
    if (!cfg.siteUrl || !cfg.consumerKey || !cfg.consumerSecret) {
      throw new Error('تنظیمات API کامل نشده است.')
    }
    try {
      return await updateOrderStatus(cfg, orderId, status)
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle('wc:product-detail', async (_event, productId: number) => {
    const cfg = getSettings()
    if (!cfg.siteUrl || !cfg.consumerKey || !cfg.consumerSecret) {
      throw new Error('تنظیمات API کامل نشده است.')
    }
    try {
      return await getProductDetail(cfg, productId)
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle('wc:product-variation-update', async (_event, productId: number, variationId: number, patch: VariationPatch) => {
    const cfg = getSettings()
    if (!cfg.siteUrl || !cfg.consumerKey || !cfg.consumerSecret) {
      throw new Error('تنظیمات API کامل نشده است.')
    }
    try {
      return await updateProductVariation(cfg, productId, variationId, patch ?? {})
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle('wc:product-update', async (_event, productId: number, patch: ProductPatch) => {
    const cfg = getSettings()
    if (!cfg.siteUrl || !cfg.consumerKey || !cfg.consumerSecret) {
      throw new Error('تنظیمات API کامل نشده است.')
    }
    try {
      return await updateProduct(cfg, productId, patch ?? {})
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle('wc:product-create', async (_event, payload: ProductPayload) => {
    const cfg = getSettings()
    if (!cfg.siteUrl || !cfg.consumerKey || !cfg.consumerSecret) {
      throw new Error('تنظیمات API کامل نشده است.')
    }
    try {
      return await createProduct(cfg, payload ?? {})
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle('print:receipt', async (_event, doc: PrintReceiptDoc) => {
    if (!doc || typeof doc.html !== 'string' || !doc.html) {
      throw new Error('سند چاپ نامعتبر است.')
    }
    return printViaDialog(doc)
  })

  ipcMain.handle('print:bulk', async (_event, doc: PrintBulkDoc) => {
    if (!doc || typeof doc.html !== 'string' || !doc.html) {
      throw new Error('سند چاپ گروهی نامعتبر است.')
    }
    return printViaDialog(doc)
  })

  ipcMain.handle('wc:product-orders', async (_event, productId: number) => {
    const cfg = getSettings()
    if (!cfg.siteUrl || !cfg.consumerKey || !cfg.consumerSecret) {
      throw new Error('تنظیمات API کامل نشده است.')
    }
    try {
      return await listProductOrders(cfg, productId)
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

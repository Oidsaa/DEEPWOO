import { contextBridge, ipcRenderer } from 'electron'
import type {
  ApiBridge,
  ChangeLogQuery,
  CustomerPayload,
  ListCustomersQuery,
  ListOrdersQuery,
  ListProductsQuery,
  OrderNotePayload,
  ProductPatch,
  ProductPayload,
  Settings,
  SyncChangeQuery,
  SyncEntityState,
  VariationPatch,
} from '../shared/types'

const api: ApiBridge = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: Settings) => ipcRenderer.invoke('settings:save', settings),
  clearSettings: () => ipcRenderer.invoke('settings:clear'),
  testConnection: (settings?: Settings) => ipcRenderer.invoke('wc:test', settings),
  listCustomers: (query: ListCustomersQuery) => ipcRenderer.invoke('wc:customers', query),
  createCustomer: (payload: CustomerPayload) => ipcRenderer.invoke('wc:create-customer', payload),
  createOrder: (payload) => ipcRenderer.invoke('wc:order-create', payload),
  findCoupon: (code: string) => ipcRenderer.invoke('wc:coupon-get', code),
  clearCache: () => ipcRenderer.invoke('cache:clear'),
  getCacheStatus: () => ipcRenderer.invoke('cache:status'),
  getReports: (query) => ipcRenderer.invoke('wc:reports', query),
  listCustomerOrders: (customerId: number) => ipcRenderer.invoke('wc:customer-orders', customerId),
  listOrders: (query: ListOrdersQuery) => ipcRenderer.invoke('wc:orders', query),
  listOrderStatusTotals: () => ipcRenderer.invoke('wc:order-status-totals'),
  listOrderNotes: (orderId: number) => ipcRenderer.invoke('wc:order-notes', orderId),
  createOrderNote: (orderId: number, payload: OrderNotePayload) =>
    ipcRenderer.invoke('wc:order-note-create', orderId, payload),
  updateOrderStatus: (orderId: number, status: string) => ipcRenderer.invoke('wc:order-status', orderId, status),
  updateOrder: (orderId: number, payload) => ipcRenderer.invoke('wc:order-update', orderId, payload),
  printReceipt: (doc) => ipcRenderer.invoke('print:receipt', doc),
  printBulk: (doc) => ipcRenderer.invoke('print:bulk', doc),
  getStoreStats: () => ipcRenderer.invoke('wc:store-stats'),
  listProducts: (query: ListProductsQuery) => ipcRenderer.invoke('wc:products', query),
  getProductCatalog: () => ipcRenderer.invoke('wc:product-catalog'),
  getProductDetail: (productId: number) => ipcRenderer.invoke('wc:product-detail', productId),
  updateProductVariation: (productId: number, variationId: number, patch: VariationPatch) =>
    ipcRenderer.invoke('wc:product-variation-update', productId, variationId, patch),
  updateProduct: (productId: number, patch: ProductPatch) => ipcRenderer.invoke('wc:product-update', productId, patch),
  createProduct: (payload: ProductPayload) => ipcRenderer.invoke('wc:product-create', payload),
  listProductOrders: (productId: number) => ipcRenderer.invoke('wc:product-orders', productId),
  getWarehousesOverview: () => ipcRenderer.invoke('warehouses:overview'),
  saveWarehouseStock: (payload) => ipcRenderer.invoke('warehouses:save-stock', payload),
  onStockChanged: (cb: () => void) => {
    const listener = () => cb()
    ipcRenderer.on('data:stock-changed', listener)
    return () => ipcRenderer.removeListener('data:stock-changed', listener)
  },
  listAccounts: () => ipcRenderer.invoke('accounts:list'),
  addAccount: (payload) => ipcRenderer.invoke('accounts:add', payload),
  removeAccount: (id: string) => ipcRenderer.invoke('accounts:remove', id),
  switchAccount: (id: string, pin?: string) => ipcRenderer.invoke('accounts:switch', id, pin),
  changeAccountPin: (id: string, current: string, next: string) =>
    ipcRenderer.invoke('accounts:change-pin', id, current, next),
  getChangeLog: (query?: ChangeLogQuery) => ipcRenderer.invoke('log:query', query ?? {}),
  getSyncChanges: (query?: SyncChangeQuery) => ipcRenderer.invoke('sync:changes', query ?? {}),
  syncNow: (entity) => ipcRenderer.invoke('sync:now', entity),
  getCurrency: () => ipcRenderer.invoke('woo:currency'),
  onSynced: (cb: (states: SyncEntityState[]) => void) => {
    const listener = (_event: unknown, states: SyncEntityState[]) => cb(states)
    ipcRenderer.on('data:synced', listener)
    return () => ipcRenderer.removeListener('data:synced', listener)
  },
}

contextBridge.exposeInMainWorld('api', api)

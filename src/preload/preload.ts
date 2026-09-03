import { contextBridge, ipcRenderer } from 'electron'
import type {
  ApiBridge,
  CustomerPayload,
  ListCustomersQuery,
  ListProductsQuery,
  ProductPatch,
  ProductPayload,
  Settings,
  VariationPatch,
} from '../shared/types'

const api: ApiBridge = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: Settings) => ipcRenderer.invoke('settings:save', settings),
  clearSettings: () => ipcRenderer.invoke('settings:clear'),
  testConnection: (settings?: Settings) => ipcRenderer.invoke('wc:test', settings),
  listCustomers: (query: ListCustomersQuery) => ipcRenderer.invoke('wc:customers', query),
  createCustomer: (payload: CustomerPayload) => ipcRenderer.invoke('wc:create-customer', payload),
  listCustomerOrders: (customerId: number) => ipcRenderer.invoke('wc:customer-orders', customerId),
  getStoreStats: () => ipcRenderer.invoke('wc:store-stats'),
  listProducts: (query: ListProductsQuery) => ipcRenderer.invoke('wc:products', query),
  getProductDetail: (productId: number) => ipcRenderer.invoke('wc:product-detail', productId),
  updateProductVariation: (productId: number, variationId: number, patch: VariationPatch) =>
    ipcRenderer.invoke('wc:product-variation-update', productId, variationId, patch),
  updateProduct: (productId: number, patch: ProductPatch) => ipcRenderer.invoke('wc:product-update', productId, patch),
  createProduct: (payload: ProductPayload) => ipcRenderer.invoke('wc:product-create', payload),
  listProductOrders: (productId: number) => ipcRenderer.invoke('wc:product-orders', productId),
}

contextBridge.exposeInMainWorld('api', api)

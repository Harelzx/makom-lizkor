export interface CheckoutPorts {
  dev: number
  e2e: number
  prod: number
  main: boolean
}

export function checkoutPorts(dir?: string): CheckoutPorts

// Synthetic demo customers. Nothing here is a real account, offer, rate or valuation.

export type Provenance = 'supplied' | 'synthetic' | 'illustrative' | 'derived' | 'missing'

export type GoalId = 'lower_payment' | 'minimize_cost' | 'replace_vehicle' | 'lease_end' | 'understand_options'

export interface Vehicle {
  id: string; customerId: string; make: string; model: string; year: number; trim: string
  estimatedMarketValue: number; valuationSource: string; valuationTimestamp: string
  odometer: number; annualMiles: number; color: string
  vin?: string | null
}

export interface FinancingAccount {
  id: string; customerId: string; financingType: 'loan' | 'lease'
  monthlyPayment: number
  currentBalance: number | null // loan only
  remainingMonths: number | null // loan only
  interestRate: number | null // APR %, null = not on file
  leaseEndDate: string | null // lease only
  mileageAllowanceTotal: number | null
  excessMileageRate: number | null // $/mile from the contract, null = not on file
  dispositionFee: number | null
  purchaseOptionPrice: number | null
}

export interface CustomerProfile {
  id: string; displayName: string; persona: string; profileType: 'loan' | 'lease'
  primaryGoal: GoalId; goalText: string; monthlyBudget: number
  keepVehiclePreference: boolean
  replacement: { label: string; price: number } // what the customer said they'd consider
  zip?: string // used to find nearby dealers
  contactPreference?: 'phone' | 'email' | 'text'
  vehicle: Vehicle; financing: FinancingAccount
}

// Fixed "as of" date so every calculation is reproducible.
export const AS_OF = '2026-10-24'
const VALUATION = { valuationSource: 'Synthetic demo estimate (not a market quote)', valuationTimestamp: '2026-10-20' }

export const CUSTOMERS: CustomerProfile[] = [
  {
    id: 'cust-maya', displayName: 'Maya Chen', persona: 'Budget tightened after a job change',
    profileType: 'loan', primaryGoal: 'lower_payment', monthlyBudget: 500, keepVehiclePreference: true,
    goalText: "I need to lower my monthly payment, but I don't want to make a bad financial decision.",
    replacement: { label: '2027 Corolla Cross LE (illustrative price)', price: 27500 }, zip: '75080',
    vehicle: { id: 'veh-maya', customerId: 'cust-maya', make: 'Toyota', model: 'RAV4', year: 2022, trim: 'XLE', estimatedMarketValue: 26400, odometer: 38200, annualMiles: 11000, color: 'Lunar Rock', ...VALUATION },
    financing: { id: 'fin-maya', customerId: 'cust-maya', financingType: 'loan', monthlyPayment: 592.72, currentBalance: 24800, remainingMonths: 48, interestRate: 6.9, leaseEndDate: null, mileageAllowanceTotal: null, excessMileageRate: null, dispositionFee: null, purchaseOptionPrice: null },
  },
  {
    id: 'cust-daniel', displayName: 'Daniel Okafor', persona: 'Lease ends in four months',
    profileType: 'lease', primaryGoal: 'lease_end', monthlyBudget: 450, keepVehiclePreference: false,
    goalText: 'My lease is ending soon. Should I return it or buy it?',
    replacement: { label: '2027 Camry SE Hybrid (illustrative price)', price: 33900 }, zip: '75201',
    vehicle: { id: 'veh-daniel', customerId: 'cust-daniel', make: 'Toyota', model: 'Camry', year: 2023, trim: 'SE', estimatedMarketValue: 23900, odometer: 34200, annualMiles: 13800, color: 'Celestial Silver', ...VALUATION },
    financing: { id: 'fin-daniel', customerId: 'cust-daniel', financingType: 'lease', monthlyPayment: 389, currentBalance: null, remainingMonths: null, interestRate: null, leaseEndDate: '2027-02-24', mileageAllowanceTotal: 36000, excessMileageRate: 0.15, dispositionFee: null, purchaseOptionPrice: 21450 },
  },
  {
    id: 'cust-priya', displayName: 'Priya Raman', persona: 'Growing family, wants to upgrade',
    profileType: 'loan', primaryGoal: 'replace_vehicle', monthlyBudget: 700, keepVehiclePreference: false,
    goalText: 'I want to trade my Tacoma for a hybrid SUV within a year without overextending.',
    replacement: { label: '2027 Grand Highlander Hybrid XLE (illustrative price)', price: 48900 }, zip: '75024',
    vehicle: { id: 'veh-priya', customerId: 'cust-priya', make: 'Toyota', model: 'Tacoma', year: 2021, trim: 'TRD Sport', estimatedMarketValue: 31500, odometer: 52100, annualMiles: 12500, color: 'Army Green', ...VALUATION },
    financing: { id: 'fin-priya', customerId: 'cust-priya', financingType: 'loan', monthlyPayment: 507.06, currentBalance: 14200, remainingMonths: 30, interestRate: 5.4, leaseEndDate: null, mileageAllowanceTotal: null, excessMileageRate: null, dispositionFee: null, purchaseOptionPrice: null },
  },
  {
    id: 'cust-marcus', displayName: 'Marcus Webb', persona: 'Budget dropped, rate not on file',
    profileType: 'loan', primaryGoal: 'lower_payment', monthlyBudget: 340, keepVehiclePreference: true,
    goalText: 'My hours were cut. I need my car payment under $340.',
    replacement: { label: '2025 Corolla LE, certified used (illustrative price)', price: 21500 }, zip: '75040',
    vehicle: { id: 'veh-marcus', customerId: 'cust-marcus', make: 'Toyota', model: 'Corolla', year: 2024, trim: 'LE', estimatedMarketValue: 19800, odometer: 14800, annualMiles: 9000, color: 'Blueprint', ...VALUATION },
    financing: { id: 'fin-marcus', customerId: 'cust-marcus', financingType: 'loan', monthlyPayment: 452, currentBalance: 21900, remainingMonths: 60, interestRate: null, leaseEndDate: null, mileageAllowanceTotal: null, excessMileageRate: null, dispositionFee: null, purchaseOptionPrice: null },
  },
]

// Synthetic cohort customers for the Impact Lab live here too, so the same tools can resolve them.
const cohort = new Map<string, CustomerProfile>()
export const registerCohort = (cs: CustomerProfile[]) => cs.forEach(c => cohort.set(c.id, c))
// Posted payments change the account; the store sets these overlays so every reader sees current state.
const accountOverlay: Map<string, Partial<FinancingAccount>> = ((globalThis as { __nextAccountOverlay?: Map<string, Partial<FinancingAccount>> }).__nextAccountOverlay ??= new Map())
export const setAccountOverlay = (id: string, patch: Partial<FinancingAccount> | null) => { if (patch && Object.keys(patch).length) accountOverlay.set(id, patch); else accountOverlay.delete(id) }
// Details the customer edited in Settings (vehicle facts, ZIP, budget, contact preference).
export interface ProfileEdit { vehicle?: Partial<Vehicle>; zip?: string; monthlyBudget?: number; contactPreference?: CustomerProfile['contactPreference'] }
const profileOverlay: Map<string, ProfileEdit> = ((globalThis as { __nextProfileOverlay?: Map<string, ProfileEdit> }).__nextProfileOverlay ??= new Map())
export const setProfileOverlay = (id: string, edit: ProfileEdit | null) => { if (edit && Object.keys(edit).length) profileOverlay.set(id, edit); else profileOverlay.delete(id) }
export const getCustomer = (id: string): CustomerProfile | null => {
  let c = CUSTOMERS.find(x => x.id === id) ?? cohort.get(id) ?? null
  if (!c) return null
  const o = accountOverlay.get(id), p = profileOverlay.get(id)
  if (o) c = { ...c, financing: { ...c.financing, ...o } }
  if (p) {
    const { vehicle, ...rest } = p
    c = { ...c, ...rest, vehicle: { ...c.vehicle, ...vehicle } }
  }
  return c
}

/** Provenance of a vehicle value: the customer's own number, the synthetic estimate, or an adjusted assumption. */
export const valueKind = (c: CustomerProfile, value: number) =>
  value !== c.vehicle.estimatedMarketValue ? 'illustrative' as const : c.vehicle.valuationSource.startsWith('Your') ? 'supplied' as const : 'synthetic' as const

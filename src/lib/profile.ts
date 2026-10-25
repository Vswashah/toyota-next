// Customer-edited profile details (Settings), validated at the boundary, plus NHTSA VIN decoding.
import { z } from 'zod'
import { AS_OF, type ProfileEdit } from './data.ts'

export const SettingsSchema = z.object({
  vin: z.string().trim().toUpperCase().regex(/^[A-HJ-NPR-Z0-9]{17}$/, 'VIN must be 17 letters/numbers (no I, O or Q)').nullable().optional(),
  year: z.number().int().min(1990).max(2028).optional(),
  model: z.string().trim().min(1).max(40).optional(),
  trim: z.string().trim().max(40).optional(),
  color: z.string().trim().max(40).optional(),
  odometer: z.number().int().min(0).max(500000).optional(),
  annualMiles: z.number().int().min(0).max(100000).optional(),
  estimatedMarketValue: z.number().min(500).max(300000).optional(),
  zip: z.string().regex(/^\d{5}$/, 'ZIP must be 5 digits').optional(),
  monthlyBudget: z.number().min(50).max(5000).optional(),
  contactPreference: z.enum(['phone', 'email', 'text']).optional(),
}).strict()
export type Settings = z.infer<typeof SettingsSchema>

/** Turns validated settings into the overlay the rest of the app reads. A value the customer types is labeled as theirs. */
export function toProfileEdit(s: Settings): ProfileEdit {
  const { zip, monthlyBudget, contactPreference, estimatedMarketValue, ...v } = s
  const vehicle = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined))
  if (estimatedMarketValue != null) Object.assign(vehicle, { estimatedMarketValue, valuationSource: 'Your estimate', valuationTimestamp: AS_OF })
  const out: ProfileEdit = {}
  if (Object.keys(vehicle).length) out.vehicle = vehicle
  if (zip) out.zip = zip
  if (monthlyBudget != null) out.monthlyBudget = monthlyBudget
  if (contactPreference) out.contactPreference = contactPreference
  return out
}

export interface DecodedVin { vin: string; year: number | null; make: string; model: string; trim: string; ok: boolean; message: string }

/** NHTSA vPIC: free, no key. Returns what the VIN says; the customer decides whether to apply it. */
export async function decodeVin(vin: string, signal?: AbortSignal): Promise<DecodedVin> {
  const v = SettingsSchema.shape.vin.parse(vin)!
  const res = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${v}?format=json`, { signal, cache: 'no-store' })
  if (!res.ok) throw new Error(`NHTSA VIN service ${res.status}`)
  const r = (await res.json()).Results?.[0] ?? {}
  const ok = String(r.ErrorCode ?? '').split(',')[0] === '0'
  return { vin: v, year: Number(r.ModelYear) || null, make: r.Make ?? '', model: r.Model ?? '', trim: r.Trim ?? '', ok, message: String(r.ErrorText ?? '').replace(/^\d+ - /, '') }
}

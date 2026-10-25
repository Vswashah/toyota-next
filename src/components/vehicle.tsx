'use client'
// 3D vehicle (<model-viewer>, public/car.glb). Callouts are bound to real profile/scenario data.
import { useEffect, type DetailedHTMLProps, type HTMLAttributes } from 'react'

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX { interface IntrinsicElements { 'model-viewer': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & Record<string, unknown> } }
}

export interface Callout { label: string; value: string; tone?: 'red' | 'ink' | 'good' | 'warn' }

const TONE = { red: 'text-red', ink: 'text-ink', good: 'text-good', warn: 'text-warn' }

export function VehicleViz({ callouts = [], name, intro = false }: { callouts?: Callout[]; name?: string; intro?: boolean }) {
  useEffect(() => { import('@google/model-viewer') }, []) // registers the custom element; touches window, so client-only
  return (
    <div className="relative w-full">
      {callouts.length > 0 && (
        <div className="relative z-10 grid grid-cols-3 gap-2 pt-3 text-center">
          {callouts.map(c => (
            <div key={c.label}>
              <div className="label">{c.label}</div>
              <div className={`num font-display text-2xl ${TONE[c.tone ?? 'ink']}`}>{c.value}</div>
            </div>
          ))}
        </div>
      )}
      <model-viewer
        src="/car.glb" alt={name ? `3D model representing ${name}` : '3D vehicle model'}
        camera-controls="" disable-zoom="" auto-rotate={intro ? '' : undefined} auto-rotate-delay="0" rotation-per-second="12deg"
        camera-orbit="-55deg 80deg 52%" min-camera-orbit="auto auto 0%" camera-target="0m 0.4m 0.24m" interaction-prompt="none" environment-image="neutral" exposure="0.9"
        shadow-intensity="1" shadow-softness="0.8"
        style={{ width: '100%', height: 'auto', aspectRatio: '800 / 360', background: 'transparent', '--poster-color': 'transparent' } as React.CSSProperties}
      />
      <div aria-hidden className="pointer-events-none absolute inset-x-[10%] bottom-[16%] h-6 rounded-full bg-[radial-gradient(closest-side,rgba(235,10,30,.28),transparent)]" />
      <a href="https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept" target="_blank" rel="noopener noreferrer"
        className="absolute bottom-0 right-0 text-[9px] text-mute/60 hover:text-mute">Model: CarConcept, Eric Chadwick / DGG, CC BY 4.0</a>
    </div>
  )
}

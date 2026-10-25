import type { Metadata } from 'next'
import AdminConsole from '@/components/admin'

export const metadata: Metadata = { title: 'TFS Team Console · TOYOTA NEXT' }

export default function AdminPage() {
  return <AdminConsole />
}

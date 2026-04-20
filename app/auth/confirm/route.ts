import { NextRequest } from 'next/server'
import { completeAuthRedirect } from '@/lib/auth/completeAuthRedirect'

export async function GET(request: NextRequest) {
  return completeAuthRedirect(request)
}

import {BotIcon,} from 'lucide-react'
import Link from 'next/link'
import React from 'react'

export const Logo = () => {
  return (
    <Link href="/" className='flex items-center gap-2'>
      <BotIcon className='size-8' strokeWidth={1.5} />
      <span className='text-[15px] mt-[5px] font-semibold hidden md:block'>Detect AI</span>
    </Link>
  )
}
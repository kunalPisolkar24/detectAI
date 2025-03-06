import React from 'react'

export const AuthHeader = ({label, title}: any) => {
  return (
    <div className='w-full flex flex-col gap-y-2'>
      <h1 className='text-3xl font-semibold'>{title}</h1>
      <div className='flex text-muted-foreground text-sm'>
        <p className='text-muted-foreground text-sm'>{label}</p>
        <p className='px-2'>|</p>
        <a href="/" className='text-foreground text-sm mb-4 font-medium'>Home</a>
        </div>
    </div>
  )
}

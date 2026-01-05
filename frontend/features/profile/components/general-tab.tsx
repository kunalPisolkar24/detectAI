"use client"

import { useState, useTransition } from "react"
import { useSession } from "next-auth/react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { format } from "date-fns"
import { Loader2, Calendar, ShieldCheck } from "lucide-react"

import { cn } from "@/lib/utils"
import { teko, inter } from "@/lib/fonts"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { UsageStats } from "./usage-stats"
import { updateProfileAction } from "../actions/update-profile"

interface GeneralTabProps {
  user: {
    id: string
    firstName: string | null
    lastName: string | null
    email: string
    image: string | null
    createdAt: Date
    isPremium: boolean
    apiCallCountDaily: number
    apiCallCountTotal: number
  }
}

const formSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
})

export const GeneralTab = ({ user }: GeneralTabProps) => {
  const [isPending, startTransition] = useTransition()
  const { update } = useSession()
  const [isEditing, setIsEditing] = useState(false)

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      firstName: user.firstName || "",
      lastName: user.lastName || "",
    },
  })

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    startTransition(async () => {
      const result = await updateProfileAction(values)
      if (result.error) {
        toast.error(result.error)
      } else {
        await update({ name: `${values.firstName} ${values.lastName}` })
        toast.success("Profile updated successfully")
        setIsEditing(false)
      }
    })
  }

  const initials = user.firstName && user.lastName
    ? `${user.firstName[0]}${user.lastName[0]}`
    : "U"

  return (
    <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <section className="space-y-6">
        <div className="flex items-center justify-between pb-4 border-b border-border/50">
          <h2 className={cn("text-2xl font-medium", teko.className)}>Profile</h2>
        </div>

        <div className="flex items-start gap-6">
          <Avatar className="h-20 w-20 border-2 border-border shadow-sm">
            <AvatarImage src={user.image || ""} />
            <AvatarFallback className="text-2xl bg-gradient-to-br from-blue-500 to-purple-600 text-white">
              {initials}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 w-full">
            {isEditing ? (
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="firstName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>First Name</FormLabel>
                          <FormControl>
                            <Input {...field} disabled={isPending} className="bg-secondary/50" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="lastName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Last Name</FormLabel>
                          <FormControl>
                            <Input {...field} disabled={isPending} className="bg-secondary/50" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="submit"
                      disabled={isPending}
                      className={cn(
                        "bg-gradient-to-r from-blue-600 to-purple-600 text-white border-0 tracking-wide text-lg",
                        teko.className
                      )}
                    >
                      {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      SAVE
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setIsEditing(false)}
                      disabled={isPending}
                      className={cn("tracking-wide text-base", teko.className)}
                    >
                      CANCEL
                    </Button>
                  </div>
                </form>
              </Form>
            ) : (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-medium">
                      {user.firstName} {user.lastName}
                    </h3>
                    <p className="text-sm text-muted-foreground">{user.email}</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                    Edit Profile
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="space-y-6">
        <div className="flex items-center justify-between pb-4 border-b border-border/50">
          <h2 className={cn("text-2xl font-medium", teko.className)}>Account Details</h2>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="p-4 rounded-lg border border-border bg-card/50">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Calendar size={14} />
              <span className="text-xs font-medium uppercase tracking-wider">Member Since</span>
            </div>
            <p className={cn("text-lg font-medium", inter.className)}>
              {format(new Date(user.createdAt), "MMMM d, yyyy")}
            </p>
          </div>

          <div className="p-4 rounded-lg border border-border bg-card/50">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <ShieldCheck size={14} />
              <span className="text-xs font-medium uppercase tracking-wider">Account Status</span>
            </div>
            <div className="flex items-center gap-2">
              <p className={cn("text-lg font-medium", inter.className)}>
                {user.isPremium ? "Premium Plan" : "Free Plan"}
              </p>
              {user.isPremium && (
                <span className="flex h-2 w-2 rounded-full bg-purple-500 animate-pulse" />
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-6">
        <div className="flex items-center justify-between pb-4 border-b border-border/50">
          <h2 className={cn("text-2xl font-medium", teko.className)}>Usage Statistics</h2>
        </div>
        <UsageStats
          dailyCount={user.apiCallCountDaily}
          totalCount={user.apiCallCountTotal}
          isPremium={user.isPremium}
        />
      </section>
    </div>
  )
}
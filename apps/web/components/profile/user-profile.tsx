"use client"
import type React from "react"
import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { useTheme } from "next-themes"
import { cn } from "@workspace/ui/lib/utils"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Badge } from "@workspace/ui/components/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@workspace/ui/components/dialog"
import { Pricing } from "@/components/landing"
import { User, Mail, Calendar, Edit2, Check, X, Github, Chrome, Sparkles, AlertTriangle, Zap, BotIcon } from "lucide-react"
import { format } from "date-fns"

// Mock user data - in a real app, this would come from your auth system
const mockUser = {
  firstName: "Alex",
  lastName: "Johnson",
  email: "alex.johnson@example.com",
  isPremium: true,
  premiumExpiry: null, // If premium, this would be a date
  connectedAccounts: [
    { provider: "google", connected: false, email: "alex.johnson@gmail.com" },
    { provider: "github", connected: false, username: "alexjohnson" },
  ],
}

interface UserProfileProps {
  // In a real app, you might pass user data from a parent component
  initialUser?: typeof mockUser
}

export const UserProfile: React.FC<UserProfileProps> = ({ initialUser = mockUser }) => {
  const { theme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [user, setUser] = useState(initialUser)
  const [isEditing, setIsEditing] = useState(false)
  const [firstName, setFirstName] = useState(user.firstName)
  const [lastName, setLastName] = useState(user.lastName)
  const [showPricingDialog, setShowPricingDialog] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase()
  }

  const handleSave = () => {
    setUser((prev) => ({
      ...prev,
      firstName,
      lastName,
    }))
    setIsEditing(false)
  }

  const handleCancel = () => {
    setFirstName(user.firstName)
    setLastName(user.lastName)
    setIsEditing(false)
  }

  const handleCancelSubscription = () => {
    // In a real app, this would call an API to cancel the subscription
    if (confirm("Are you sure you want to cancel your premium subscription?")) {
      setUser((prev) => ({
        ...prev,
        isPremium: false,
        premiumExpiry: null,
      }))
    }
  }

  // Mock function to simulate upgrading to premium
  const handleUpgradeToPremium = () => {
    // In a real app, this would redirect to a payment page or process
    setShowPricingDialog(false)

    // Simulate successful upgrade
    const expiryDate = new Date()
    expiryDate.setFullYear(expiryDate.getFullYear() + 1)

    setUser((prev : any) => ({
      ...prev,
      isPremium: true,
      premiumExpiry: expiryDate,
    }))
  }

  return (
    <section
      className={cn(
        "w-full relative overflow-hidden transition-colors duration-300 py-12",
        theme === "dark" ? "bg-background text-foreground" : "bg-background text-foreground",
      )}
    >
      {/* Animated background elements */}
      <div className="absolute inset-0 opacity-10 pointer-events-none">
        <div
          className={cn(
            "absolute inset-0 animate-gradient-slow",
            theme === "dark"
              ? "bg-gradient-to-r from-purple-500/10 via-blue-500/10 to-cyan-500/10"
              : "bg-gradient-to-r from-purple-300/20 via-blue-300/20 to-cyan-300/20",
          )}
        />
        <motion.div
          className={cn(
            "absolute top-1/3 -left-32 w-96 h-96 rounded-full blur-3xl",
            theme === "dark" ? "bg-purple-600/20" : "bg-purple-400/20",
          )}
          animate={{
            x: [0, 50, 0],
            y: [0, 30, 0],
          }}
          transition={{
            duration: 15,
            repeat: Number.POSITIVE_INFINITY,
            ease: "easeInOut",
          }}
        />
        <motion.div
          className={cn(
            "absolute bottom-1/3 -right-32 w-96 h-96 rounded-full blur-3xl",
            theme === "dark" ? "bg-blue-600/20" : "bg-blue-400/20",
          )}
          animate={{
            x: [0, -50, 0],
            y: [0, -30, 0],
          }}
          transition={{
            duration: 18,
            repeat: Number.POSITIVE_INFINITY,
            ease: "easeInOut",
          }}
        />
      </div>

      <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-5xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <h1
            className={cn(
              "text-3xl sm:text-4xl font-bold tracking-tight",
              theme === "dark"
                ? "bg-clip-text text-transparent bg-gradient-to-r from-white via-blue-400 to-white bg-[length:200%_100%]"
                : "bg-clip-text text-transparent bg-gradient-to-r from-gray-900 via-blue-600 to-gray-900 bg-[length:200%_100%]",
            )}
            style={{
              backgroundPosition: "0% 0%",
              animation: "gradientMove 5s linear infinite",
            }}
          >
            Your Profile
          </h1>
          <p className={cn("mt-2 text-base", theme === "dark" ? "text-neutral-300" : "text-neutral-600")}>
            Manage your personal information and subscription
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Left column - Avatar and basic info */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className={cn(
              "col-span-1 flex flex-col items-center p-6 rounded-xl border",
              theme === "dark"
                ? "bg-black/40 backdrop-blur-sm border-white/10"
                : "bg-white/70 backdrop-blur-sm border-black/10",
            )}
          >
            {/* Avatar with initials fallback */}
            <motion.div
              whileHover={{ scale: 1.05 }}
              transition={{ type: "spring", stiffness: 400, damping: 10 }}
              className={cn(
                "w-32 h-32 rounded-full flex items-center justify-center text-3xl font-bold mb-4 overflow-hidden",
                theme === "dark"
                  ? "bg-gradient-to-br from-blue-600 to-purple-600 text-white"
                  : "bg-gradient-to-br from-blue-500 to-purple-500 text-white",
              )}
            >
              {getInitials(user.firstName, user.lastName)}
            </motion.div>

            {/* Premium badge if applicable */}
            {user.isPremium && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: "spring", stiffness: 400, damping: 10 }}
                className="mb-4"
              >
                <Badge
                  className={cn(
                    "px-3 py-1 font-medium flex items-center gap-1",
                    theme === "dark"
                      ? "bg-gradient-to-r from-yellow-500 to-amber-500 text-black"
                      : "bg-gradient-to-r from-yellow-400 to-amber-400 text-black",
                  )}
                >
                  <Sparkles size={14} />
                  Premium Member
                </Badge>
              </motion.div>
            )}

            {/* User name */}
            <AnimatePresence mode="wait">
              {!isEditing ? (
                <motion.div
                  key="display-name"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-center"
                >
                  <h2 className="text-xl font-semibold mb-1">
                    {user.firstName} {user.lastName}
                  </h2>
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setIsEditing(true)}
                    className={cn(
                      "text-xs flex items-center gap-1 mx-auto mt-1 px-2 py-1 rounded",
                      theme === "dark"
                        ? "text-neutral-400 hover:text-white hover:bg-white/10"
                        : "text-neutral-600 hover:text-black hover:bg-black/5",
                    )}
                  >
                    <Edit2 size={12} />
                    Edit Name
                  </motion.button>
                </motion.div>
              ) : (
                <motion.div
                  key="edit-name"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="w-full space-y-3"
                >
                  <div>
                    <Label htmlFor="firstName" className="text-xs">
                      First Name
                    </Label>
                    <Input
                      id="firstName"
                      value={firstName}
                      onChange={(e: any) => setFirstName(e.target.value)}
                      className={cn(
                        "mt-1",
                        theme === "dark" ? "bg-black/60 border-white/20" : "bg-white border-black/20",
                      )}
                    />
                  </div>
                  <div>
                    <Label htmlFor="lastName" className="text-xs">
                      Last Name
                    </Label>
                    <Input
                      id="lastName"
                      value={lastName}
                      onChange={(e: any) => setLastName(e.target.value)}
                      className={cn(
                        "mt-1",
                        theme === "dark" ? "bg-black/60 border-white/20" : "bg-white border-black/20",
                      )}
                    />
                  </div>
                  <div className="flex gap-2 justify-center mt-3">
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={handleSave}
                      className={cn(
                        "text-xs flex items-center gap-1 px-3 py-1.5 rounded",
                        theme === "dark"
                          ? "bg-green-600 hover:bg-green-700 text-white"
                          : "bg-green-500 hover:bg-green-600 text-white",
                      )}
                    >
                      <Check size={12} />
                      Save
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={handleCancel}
                      className={cn(
                        "text-xs flex items-center gap-1 px-3 py-1.5 rounded",
                        theme === "dark"
                          ? "bg-red-600 hover:bg-red-700 text-white"
                          : "bg-red-500 hover:bg-red-600 text-white",
                      )}
                    >
                      <X size={12} />
                      Cancel
                    </motion.button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Email */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.3 }}
              className={cn(
                "flex items-center gap-2 mt-6 text-sm",
                theme === "dark" ? "text-neutral-300" : "text-neutral-700",
              )}
            >
              <Mail size={16} className={theme === "dark" ? "text-blue-400" : "text-blue-600"} />
              {user.email}
            </motion.div>

            {/* Premium status */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.4 }}
              className="mt-8 w-full"
            >
              {user.isPremium ? (
                <div className="space-y-3">
                  <div
                    className={cn(
                      "text-sm flex items-center gap-2",
                      theme === "dark" ? "text-neutral-300" : "text-neutral-700",
                    )}
                  >
                    <Calendar size={16} className={theme === "dark" ? "text-blue-400" : "text-blue-600"} />
                    Premium expires: {format(new Date(user.premiumExpiry!), "MMMM d, yyyy")}
                  </div>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleCancelSubscription}
                    className={cn(
                      "w-full py-2 rounded-md text-sm font-medium flex items-center justify-center gap-2",
                      theme === "dark"
                        ? "bg-red-600/80 hover:bg-red-700 text-white"
                        : "bg-red-500/80 hover:bg-red-600 text-white",
                    )}
                  >
                    <AlertTriangle size={14} />
                    Cancel Subscription
                  </motion.button>
                </div>
              ) : (
                <Dialog open={showPricingDialog} onOpenChange={setShowPricingDialog}>
                  <DialogTrigger asChild>
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      className={cn(
                        "w-full py-2 rounded-md text-sm font-medium flex items-center justify-center gap-2",
                        theme === "dark"
                          ? "bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white"
                          : "bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white",
                      )}
                    >
                      <Sparkles size={14} />
                      Upgrade to Premium
                    </motion.button>
                  </DialogTrigger>
                  <DialogContent
                    className={cn(
                      "max-w-4xl p-0 overflow-hidden border",
                      theme === "dark" ? "bg-black/90 border-white/10" : "bg-white border-black/10",
                    )}
                  >
                    <DialogHeader className="p-6 pb-0">
                      <DialogTitle
                        className={cn(
                          "text-2xl font-bold text-center",
                          theme === "dark"
                            ? "bg-clip-text text-transparent bg-gradient-to-r from-white via-blue-400 to-white"
                            : "bg-clip-text text-transparent bg-gradient-to-r from-gray-900 via-blue-600 to-gray-900",
                        )}
                      >
                        Upgrade to Premium
                      </DialogTitle>
                    </DialogHeader>
                    <div className="overflow-y-auto max-h-[70vh]">
                      <Pricing />
                    </div>
                  </DialogContent>
                </Dialog>
              )}
            </motion.div>
          </motion.div>

          {/* Right column - Account details and connected accounts */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="col-span-1 md:col-span-2 space-y-6"
          >
            {/* Account Information */}
            <div
              className={cn(
                "p-6 rounded-xl border",
                theme === "dark"
                  ? "bg-black/40 backdrop-blur-sm border-white/10"
                  : "bg-white/70 backdrop-blur-sm border-black/10",
              )}
            >
              <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <User className={theme === "dark" ? "text-blue-400" : "text-blue-600"} size={20} />
                Account Information
              </h2>

              <div className="space-y-4">
                <div>
                  <h3
                    className={cn(
                      "text-sm font-medium mb-1",
                      theme === "dark" ? "text-neutral-300" : "text-neutral-700",
                    )}
                  >
                    Account Type
                  </h3>
                  <p className={cn("text-sm", theme === "dark" ? "text-white" : "text-black")}>
                    {user.isPremium ? "Premium" : "Free"}
                  </p>
                </div>

                <div>
                  <h3
                    className={cn(
                      "text-sm font-medium mb-1",
                      theme === "dark" ? "text-neutral-300" : "text-neutral-700",
                    )}
                  >
                    Account Status
                  </h3>
                  <Badge
                    className={cn(
                      "px-2 py-0.5 text-xs",
                      theme === "dark" ? "bg-green-600/80 text-white" : "bg-green-500/80 text-white",
                    )}
                  >
                    Active
                  </Badge>
                </div>

                <div>
                  <h3
                    className={cn(
                      "text-sm font-medium mb-1",
                      theme === "dark" ? "text-neutral-300" : "text-neutral-700",
                    )}
                  >
                    Member Since
                  </h3>
                  <p className={cn("text-sm", theme === "dark" ? "text-white" : "text-black")}>January 15, 2023</p>
                </div>
              </div>
            </div>

            {/* Connected Accounts */}
            <div
              className={cn(
                "p-6 rounded-xl border",
                theme === "dark"
                  ? "bg-black/40 backdrop-blur-sm border-white/10"
                  : "bg-white/70 backdrop-blur-sm border-black/10",
              )}
            >
              <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <Github className={theme === "dark" ? "text-blue-400" : "text-blue-600"} size={20} />
                Connected Accounts
              </h2>

              <div className="space-y-4">
                {/* Google Account */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.4 }}
                  className={cn(
                    "flex items-center justify-between p-3 rounded-lg",
                    theme === "dark" ? "bg-white/5 hover:bg-white/10" : "bg-black/5 hover:bg-black/10",
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Chrome size={24} className="text-red-500" />
                    <div>
                      <h3 className={cn("text-sm font-medium", theme === "dark" ? "text-white" : "text-black")}>
                        Google
                      </h3>
                      <p className={cn("text-xs", theme === "dark" ? "text-neutral-400" : "text-neutral-600")}>
                        {user.connectedAccounts[0]!.email}
                      </p>
                    </div>
                  </div>
                  <Badge
                    className={cn(
                      "px-2 py-0.5 text-xs",
                      theme === "dark" ? "bg-green-600/80 text-white" : "bg-green-500/80 text-white",
                    )}
                  >
                    Connected
                  </Badge>
                </motion.div>

                {/* GitHub Account */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.5 }}
                  className={cn(
                    "flex items-center justify-between p-3 rounded-lg",
                    theme === "dark" ? "bg-white/5 hover:bg-white/10" : "bg-black/5 hover:bg-black/10",
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Github size={24} className={theme === "dark" ? "text-white" : "text-black"} />
                    <div>
                      <h3 className={cn("text-sm font-medium", theme === "dark" ? "text-white" : "text-black")}>
                        GitHub
                      </h3>
                      <p className={cn("text-xs", theme === "dark" ? "text-neutral-400" : "text-neutral-600")}>
                        {user.connectedAccounts[1]!.username}
                      </p>
                    </div>
                  </div>
                  <Badge
                    className={cn(
                      "px-2 py-0.5 text-xs",
                      theme === "dark" ? "bg-green-600/80 text-white" : "bg-green-500/80 text-white",
                    )}
                  >
                    Connected
                  </Badge>
                </motion.div>
              </div>
            </div>

            {/* Usage Statistics */}
            <div
              className={cn(
                "p-6 rounded-xl border",
                theme === "dark"
                  ? "bg-black/40 backdrop-blur-sm border-white/10"
                  : "bg-white/70 backdrop-blur-sm border-black/10",
              )}
            >
              <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <BotIcon className={theme === "dark" ? "text-blue-400" : "text-blue-600"} size={20} />
                Usage Statistics
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.6 }}
                  className={cn("p-4 rounded-lg", theme === "dark" ? "bg-white/5" : "bg-black/5")}
                >
                  <h3
                    className={cn(
                      "text-sm font-medium mb-1",
                      theme === "dark" ? "text-neutral-300" : "text-neutral-700",
                    )}
                  >
                    API Calls
                  </h3>
                  <p className={cn("text-2xl font-bold", theme === "dark" ? "text-white" : "text-black")}>87 / 100</p>
                  <p className={cn("text-xs mt-1", theme === "dark" ? "text-neutral-400" : "text-neutral-600")}>
                    Daily limit
                  </p>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.7 }}
                  className={cn("p-4 rounded-lg", theme === "dark" ? "bg-white/5" : "bg-black/5")}
                >
                  <h3
                    className={cn(
                      "text-sm font-medium mb-1",
                      theme === "dark" ? "text-neutral-300" : "text-neutral-700",
                    )}
                  >
                    Texts Analyzed
                  </h3>
                  <p className={cn("text-2xl font-bold", theme === "dark" ? "text-white" : "text-black")}>342</p>
                  <p className={cn("text-xs mt-1", theme === "dark" ? "text-neutral-400" : "text-neutral-600")}>
                    This month
                  </p>
                </motion.div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}


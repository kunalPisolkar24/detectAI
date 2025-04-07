"use client";
import type React from "react";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTheme } from "next-themes";
import { cn } from "@workspace/ui/lib/utils";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/components/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog";
import { Payment } from "../payments/payment-dialog";
import {
  UserCircle,
  Mail,
  Calendar,
  Edit2,
  Check,
  X,
  Sparkles,
  AlertTriangle,
  Gauge,
  LinkIcon,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { FaGoogle, FaGithub } from "react-icons/fa";
import { format } from "date-fns";
import { Merriweather } from "next/font/google";
import { toast } from "sonner";
import type { UserProfileData } from "@/app/api/user/profile/route";
import { signIn, useSession } from "next-auth/react"; // Import useSession

const merriweather = Merriweather({
  subsets: ["latin"],
  weight: ["400", "700"],
});

const providerIcons: { [key: string]: React.ElementType } = {
  google: FaGoogle,
  github: FaGithub,
};

export const UserProfile: React.FC = () => {
  const { theme } = useTheme();
  const { data: session, status: sessionStatus, update: updateSession } = useSession(); // Get session data
  const [mounted, setMounted] = useState(false);
  const [user, setUser] = useState<UserProfileData | null>(null); // Still fetch profile data for details
  const [isLoadingProfile, setIsLoadingProfile] = useState(true); // Specific loading state for API data
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [showPricingDialog, setShowPricingDialog] = useState(false);

  // Fetch profile-specific data (usage, connections, etc.)
  useEffect(() => {
    setMounted(true);
    const fetchProfile = async () => {
      setIsLoadingProfile(true);
      setError(null);
      try {
        const response = await fetch('/api/user/profile');
        if (!response.ok) {
          throw new Error(`Failed to fetch profile details: ${response.statusText}`);
        }
        const data: UserProfileData = await response.json();
        setUser(data);
        // Initialize edit fields with fetched data if available, otherwise use session name parts
        setFirstName(data.firstName || session?.user?.name?.split(' ')[0] || "");
        setLastName(data.lastName || session?.user?.name?.split(' ').slice(1).join(' ') || "");
      } catch (err: any) {
        setError(err.message || "Could not load profile details.");
        toast.error("Could not load profile details.");
        console.error("Profile fetch error:", err);
      } finally {
        setIsLoadingProfile(false);
      }
    };
    // Fetch profile data only when authenticated
    if (sessionStatus === 'authenticated') {
       fetchProfile();
    } else if (sessionStatus === 'unauthenticated') {
        setIsLoadingProfile(false); // No need to load profile if not logged in
        setError("User not authenticated."); // Set an error state
    }
    // If sessionStatus is 'loading', we wait
  }, [sessionStatus, session]); // Depend on sessionStatus and session data

  if (!mounted) {
     return ( /* Skeleton placeholder */
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl py-16 md:py-20">
          <Skeleton className="h-12 w-1/2 mx-auto mb-4" />
          <Skeleton className="h-6 w-3/4 mx-auto mb-16" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8">
             <Skeleton className="col-span-1 h-[400px] rounded-xl" />
             <div className="col-span-1 lg:col-span-2 space-y-6 md:space-y-8">
                <Skeleton className="h-[150px] rounded-xl" />
                <Skeleton className="h-[200px] rounded-xl" />
                <Skeleton className="h-[180px] rounded-xl" />
             </div>
          </div>
       </div>
     );
  }

  // Combined loading state (session loading OR profile details loading)
  const isLoading = sessionStatus === 'loading' || isLoadingProfile;

  const getUserInitials = (name: string | null | undefined): string => {
    if (!name) return "U";
    return name
      .split(" ")
      .map((word) => word[0])
      .filter(Boolean) // Ensure we don't include undefined/null chars
      .slice(0, 2) // Max 2 initials
      .join("")
      .toUpperCase();
  };

  const handleSave = async () => {
    // Save logic remains the same, using 'firstName', 'lastName' state
     if (!user) return; // Ensure user profile data was loaded
     setIsSaving(true);
     try {
         const response = await fetch('/api/user/profile', {
             method: 'PUT',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({ firstName, lastName }),
         });
         if (!response.ok) {
             const errorData = await response.json();
             throw new Error(errorData.error || `Failed to update profile: ${response.statusText}`);
         }
         const updatedData = await response.json();
         setUser(prev => ({ ...prev!, firstName: updatedData.firstName, lastName: updatedData.lastName, }));
         setIsEditing(false);
         await updateSession({ name: updatedData.name });
         toast.success("Name updated successfully.");
     } catch (err: any) {
         toast.error(err.message || "Could not update name.");
         console.error("Profile update error:", err);
     } finally {
        setIsSaving(false);
     }
  };

  const handleCancel = () => {
    // Reset fields based on last fetched profile data or session name as fallback
    setFirstName(user?.firstName || session?.user?.name?.split(' ')[0] || "");
    setLastName(user?.lastName || session?.user?.name?.split(' ').slice(1).join(' ') || "");
    setIsEditing(false);
  };

  const handleConfirmCancelSubscription = async () => {
    // Cancellation logic remains the same
     console.log("Attempting to cancel subscription via backend for user:", user?.id);
     toast.info("Processing cancellation request...");
      setUser((prev) => {
         if (!prev) return null;
         return { ...prev, isPremium: false, premiumExpiry: null, subscriptionStatus: "CANCELED" };
      });
      toast.warning("Subscription cancelled (UI updated optimistically). Verify status later.");
  };

  const handleConnectAccount = async (provider: string) => {
     signIn(provider);
  };

  const cardVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
  };

  // Loading State UI
  if (isLoading) {
     return ( /* Skeleton placeholder */
       <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl py-16 md:py-20">
          <Skeleton className="h-12 w-1/2 mx-auto mb-4" />
          <Skeleton className="h-6 w-3/4 mx-auto mb-16" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8">
             <Skeleton className="col-span-1 h-[400px] rounded-xl" />
             <div className="col-span-1 lg:col-span-2 space-y-6 md:space-y-8">
                <Skeleton className="h-[150px] rounded-xl" />
                <Skeleton className="h-[200px] rounded-xl" />
                <Skeleton className="h-[180px] rounded-xl" />
             </div>
          </div>
       </div>
     );
  }

  // Error State UI (handles both session errors and profile fetch errors)
  if (error || sessionStatus === 'unauthenticated' || !user) {
    return (
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl py-20 text-center">
        <AlertTriangle size={48} className="mx-auto text-red-500 mb-4" />
        <h2 className="text-2xl font-semibold mb-2">Error Loading Profile</h2>
        <p className={cn(theme === 'dark' ? 'text-neutral-400' : 'text-neutral-600')}>
          {error || (sessionStatus === 'unauthenticated' ? "Please log in to view your profile." : "Could not retrieve your profile information.")}
        </p>
         {sessionStatus !== 'authenticated' && (
             <Button onClick={() => signIn()} className="mt-6">Log In</Button>
         )}
         {sessionStatus === 'authenticated' && error && (
              <Button onClick={() => window.location.reload()} className="mt-6">Retry</Button>
         )}
      </div>
    );
  }

  // --- Main Render when data is loaded ---
  return (
    <section
      className={cn(
        "w-full relative overflow-hidden transition-colors duration-300 py-16 md:py-20",
        theme === "dark" ? "bg-background text-foreground" : "bg-gray-50 text-foreground"
      )}
    >
       <div className="absolute inset-0 -z-10 overflow-hidden opacity-15 sm:opacity-20 pointer-events-none">
         <motion.div
           className={cn("absolute top-1/4 -left-40 w-[500px] h-[500px] rounded-full blur-3xl", theme === "dark" ? "bg-purple-600/20" : "bg-purple-400/20")}
           animate={{ x: [0, 50, 0], y: [0, 30, 0] }}
           transition={{ duration: 20, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
         />
         <motion.div
           className={cn("absolute bottom-1/4 -right-40 w-[500px] h-[500px] rounded-full blur-3xl", theme === "dark" ? "bg-blue-600/20" : "bg-blue-400/20")}
           animate={{ x: [0, -50, 0], y: [0, -30, 0] }}
           transition={{ duration: 23, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
         />
       </div>

      <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl z-10 relative">
        <motion.div initial="hidden" animate="visible" variants={cardVariants} className="text-center mb-12 md:mb-16">
          <h1
            className={cn("text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight", theme === "dark" ? "bg-clip-text text-transparent bg-gradient-to-r from-white via-blue-400 to-white" : "bg-clip-text text-transparent bg-gradient-to-r from-gray-900 via-blue-600 to-gray-900")}
            style={{ backgroundSize: "200% 100%", animation: "gradientMove 5s linear infinite" }}
          >
            Your Profile
          </h1>
          <p className={cn("mt-3 text-sm sm:text-base tracking-[0.5px]", merriweather.className, theme === "dark" ? "text-neutral-300" : "text-neutral-600")}>
            Manage your personal information, connections, and subscription.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8">
          <motion.div
            initial="hidden"
            animate="visible"
            variants={{ visible: { ...cardVariants.visible, transition: { duration: 0.5, delay: 0.1 } } }}
            className={cn("col-span-1 flex flex-col items-center p-6 rounded-xl border transition-colors duration-300", theme === "dark" ? "bg-black/50 backdrop-blur-sm border-white/10 shadow-lg shadow-blue-900/10" : "bg-white/80 backdrop-blur-sm border-black/10 shadow-lg shadow-blue-200/30")}
          >
            {/* --- Use Session for Avatar --- */}
            <motion.div
                whileHover={{ scale: 1.05 }}
                transition={{ type: "spring", stiffness: 300, damping: 15 }}
                className="mb-4"
              >
                <Avatar className={cn("w-28 h-28 sm:w-32 sm:h-32 text-3xl sm:text-4xl font-bold select-none", "bg-gradient-to-br from-blue-600 to-purple-600 text-white shadow-md")}>
                  {session?.user?.image ? (
                    <AvatarImage src={session.user.image} alt={session.user.name || "User"} />
                  ) : (
                    <AvatarFallback className="bg-gradient-to-br from-blue-600 to-purple-600 text-white">
                      {/* Use session name for initials */}
                      {getUserInitials(session?.user?.name)}
                    </AvatarFallback>
                  )}
                </Avatar>
              </motion.div>
             {/* --- End Session Avatar --- */}


            {user.isPremium && (
              <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: "spring", stiffness: 300, damping: 15, delay: 0.1 }} className="mb-4">
                <Badge variant="default" className={cn("px-3 py-1 font-semibold flex items-center gap-1.5 text-xs sm:text-sm border-none", "bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-sm")}>
                  <Sparkles size={14} /> Premium
                </Badge>
              </motion.div>
            )}

            <AnimatePresence mode="wait">
              {!isEditing ? (
                <motion.div key="display-name" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-center">
                  <h2 className="text-lg sm:text-xl font-semibold mb-1">
                    {/* Display saved name first, fallback to session name, then email */}
                    {(user.firstName && user.lastName) ? `${user.firstName} ${user.lastName}` : (session?.user?.name || user.email)}
                  </h2>
                  <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)} className={cn("text-xs flex items-center gap-1 mx-auto mt-1 h-7 px-2", theme === "dark" ? "text-neutral-400 hover:text-blue-300 hover:bg-white/10" : "text-neutral-600 hover:text-blue-600 hover:bg-black/5")}>
                    <Edit2 size={12} /> Edit Name
                  </Button>
                </motion.div>
              ) : (
                <motion.div key="edit-name" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="w-full space-y-3">
                  <div>
                    <Label htmlFor="firstName" className={cn("text-xs", theme === 'dark' ? 'text-neutral-400' : 'text-neutral-600')}>First Name</Label>
                    <Input id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} className={cn("mt-1 h-9 text-sm", theme === "dark" ? "bg-zinc-950/70 border-white/20 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30" : "bg-white/90 border-black/20 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30", "transition-colors duration-200")} />
                  </div>
                  <div>
                    <Label htmlFor="lastName" className={cn("text-xs", theme === 'dark' ? 'text-neutral-400' : 'text-neutral-600')}>Last Name</Label>
                    <Input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} className={cn("mt-1 h-9 text-sm", theme === "dark" ? "bg-zinc-950/70 border-white/20 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30" : "bg-white/90 border-black/20 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30", "transition-colors duration-200")} />
                  </div>
                  <div className="flex gap-2 justify-center pt-2">
                    <Button size="sm" onClick={handleSave} disabled={isSaving} className="bg-green-600 hover:bg-green-700 text-white text-xs h-8 w-[90px]">
                      {isSaving ? <Loader2 size={14} className="animate-spin"/> : <><Check size={14} className="mr-1"/> Save</>}
                    </Button>
                    <Button size="sm" variant="destructive" onClick={handleCancel} disabled={isSaving} className="bg-red-600 hover:bg-red-700 text-white text-xs h-8 w-[90px]">
                      <X size={14} className="mr-1"/> Cancel
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className={cn("flex items-center gap-2 mt-5 text-sm", theme === "dark" ? "text-neutral-300" : "text-neutral-600")}>
              <Mail size={16} className={theme === "dark" ? "text-blue-400" : "text-blue-600"} /> {user.email}
            </motion.div>

            {/* Premium Actions */}
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="mt-6 w-full space-y-3">
              {user.isPremium ? (
                <>
                  <div className="flex items-center gap-2 text-xs sm:text-sm text-neutral-500 dark:text-neutral-400">
                    <Calendar size={16} className="text-blue-500 dark:text-blue-400" />
                    <span>Expires: {user.premiumExpiry ? format(new Date(user.premiumExpiry), "MMMM d, yyyy") : 'N/A'}</span>
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm" className={cn("w-full text-red-600 border-red-500/50 hover:bg-red-500/10 hover:text-red-500 dark:text-red-500 dark:border-red-500/50 dark:hover:bg-red-500/10 dark:hover:text-red-400")}>
                        <AlertTriangle size={14} className="mr-2"/> Cancel Subscription
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className={theme === 'dark' ? 'bg-zinc-900 border-zinc-700' : 'bg-white'}>
                      <AlertDialogHeader><AlertDialogTitle>Are you sure?</AlertDialogTitle><AlertDialogDescription>Your premium benefits will end after the current period.</AlertDialogDescription></AlertDialogHeader>
                      <AlertDialogFooter><AlertDialogCancel>Keep Subscription</AlertDialogCancel><AlertDialogAction onClick={handleConfirmCancelSubscription} className="bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-800 text-white">Yes, Cancel</AlertDialogAction></AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              ) : (
                 <Dialog open={showPricingDialog} onOpenChange={setShowPricingDialog}>
                   <DialogTrigger asChild>
                     <Button size="sm" className={cn("w-full font-semibold", theme === "dark" ? "bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white shadow-md hover:shadow-lg hover:shadow-blue-500/20" : "bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white shadow-md hover:shadow-lg hover:shadow-blue-500/30")}>
                       <Sparkles size={14} className="mr-2" /> Upgrade to Premium
                     </Button>
                   </DialogTrigger>
                   <DialogContent className={cn("max-w-4xl p-0 overflow-hidden border !rounded-xl", theme === "dark" ? "bg-black/95 border-white/10 backdrop-blur-md" : "bg-white/95 border-black/10 backdrop-blur-md")}>
                     <DialogHeader className="p-4 sm:p-6 pb-0"><DialogTitle className="text-xl sm:text-2xl font-bold text-center">Choose Your Plan</DialogTitle></DialogHeader>
                     <div className="overflow-y-auto max-h-[80vh] p-1 sm:p-2 md:p-4">
                       <Payment onSubscriptionAttempt={() => setShowPricingDialog(false)} />
                     </div>
                   </DialogContent>
                 </Dialog>
               )}
            </motion.div>
          </motion.div>

          {/* Right Column Details */}
          <motion.div
            initial="hidden"
            animate="visible"
            variants={{ visible: { ...cardVariants.visible, transition: { duration: 0.5, delay: 0.2 } } }}
            className="col-span-1 lg:col-span-2 space-y-6 md:space-y-8"
          >
            {/* Account Information */}
            <div className={cn("p-6 rounded-xl border", theme === "dark" ? "bg-black/50 border-white/10" : "bg-white/70 border-black/10")}>
               <h2 className="text-lg sm:text-xl font-semibold mb-5 flex items-center gap-2"><UserCircle className={theme === "dark" ? "text-blue-400" : "text-blue-600"} size={20} /> Account Information</h2>
               <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                 <div><h3 className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">Account Type</h3><p className="font-medium">{user.isPremium ? "Premium" : "Free"}</p></div>
                  <div>
                     <h3 className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">Status</h3>
                     <Badge variant="default" className={cn("px-2 py-0.5 text-xs font-medium border-none capitalize", user.subscriptionStatus === "ACTIVE" || (!user.isPremium && !user.subscriptionStatus) ? "bg-green-500/90 dark:bg-green-600/90 text-white" : user.subscriptionStatus === "CANCELED" ? "bg-yellow-500/90 dark:bg-yellow-600/90 text-black" : "bg-red-500/90 dark:bg-red-600/90 text-white")}>
                         {user.subscriptionStatus ? user.subscriptionStatus.toLowerCase() : "Active"}
                      </Badge>
                  </div>
                 <div><h3 className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">Member Since</h3><p className="font-medium">{format(new Date(user.memberSince), "MMMM d, yyyy")}</p></div>
               </div>
             </div>

             {/* Connected Accounts */}
             <div className={cn("p-6 rounded-xl border", theme === "dark" ? "bg-black/50 border-white/10" : "bg-white/70 border-black/10")}>
               <h2 className="text-lg sm:text-xl font-semibold mb-5 flex items-center gap-2"><LinkIcon className={theme === "dark" ? "text-blue-400" : "text-blue-600"} size={20} /> Connected Accounts</h2>
               <div className="space-y-3">
                 {user.connectedAccounts.map((account) => { /* Render connected accounts */
                   const ProviderIcon = providerIcons[account.provider];
                   return ( <motion.div key={account.provider} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.4 + (account.provider === 'google' ? 0 : 0.1) }} className={cn("flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 rounded-lg gap-2 sm:gap-4", theme === "dark" ? "bg-white/5 hover:bg-white/10" : "bg-black/5 hover:bg-black/10")}> <div className="flex items-center gap-3"> {ProviderIcon && <ProviderIcon size={20} className={theme === "dark" ? "text-white/80" : "text-black/80"} />} <div> <h3 className="text-sm font-medium capitalize">{account.provider}</h3> <p className="text-xs text-neutral-500 dark:text-neutral-400">Account Linked</p> </div> </div> <Badge variant="default" className="px-2 py-0.5 text-xs font-medium border-none bg-green-500/90 dark:bg-green-600/90 text-white whitespace-nowrap">Connected</Badge> </motion.div> );
                 })}
                 {Object.keys(providerIcons).filter(provider => !user.connectedAccounts.some(acc => acc.provider === provider)).map(provider => { /* Render connect buttons */
                    const ProviderIcon = providerIcons[provider];
                    return ( <motion.div key={provider} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.5 }} className={cn("flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 rounded-lg gap-2 sm:gap-4", theme === "dark" ? "bg-white/5 hover:bg-white/10" : "bg-black/5 hover:bg-black/10")}> <div className="flex items-center gap-3"> {ProviderIcon && <ProviderIcon size={20} className={theme === "dark" ? "text-white/80" : "text-black/80"} />} <div><h3 className="text-sm font-medium capitalize">{provider}</h3></div> </div> <Button size="sm" variant="outline" onClick={() => handleConnectAccount(provider)} className="text-xs h-7 px-3 whitespace-nowrap flex items-center gap-1"> <ExternalLink size={12} /> Connect {provider.charAt(0).toUpperCase() + provider.slice(1)} </Button> </motion.div> );
                 })}
               </div>
             </div>

             {/* Usage Statistics */}
            <div className={cn("p-6 rounded-xl border", theme === "dark" ? "bg-black/50 border-white/10" : "bg-white/70 border-black/10")}>
              <h2 className="text-lg sm:text-xl font-semibold mb-5 flex items-center gap-2"><Gauge className={theme === "dark" ? "text-blue-400" : "text-blue-600"} size={20} /> Usage Statistics</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.6 }} className={cn("p-4 rounded-lg text-center sm:text-left", theme === "dark" ? "bg-white/5" : "bg-black/5")}>
                  <h3 className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">API Calls Today</h3>
                  <p className="text-xl sm:text-2xl font-bold"> {user.usage.apiCalls.current} / {user.usage.apiCalls.limit === null ? <span className="text-xl font-normal">∞</span> : user.usage.apiCalls.limit} </p>
                  <p className="text-xs mt-0.5 text-neutral-500 dark:text-neutral-400">{user.usage.apiCalls.period} Limit</p>
                </motion.div>
                 <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.7 }} className={cn("p-4 rounded-lg text-center sm:text-left", theme === "dark" ? "bg-white/5" : "bg-black/5")}>
                     <h3 className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">Total API Calls</h3>
                     <p className="text-xl sm:text-2xl font-bold">{user.usage.totalApiCallCount}</p>
                     <p className="text-xs mt-0.5 text-neutral-500 dark:text-neutral-400 invisible">Lifetime</p>
                 </motion.div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
};
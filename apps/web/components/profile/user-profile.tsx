// "use client";
// import type React from "react";
// import { useState, useEffect } from "react";
// import { motion, AnimatePresence } from "framer-motion";
// import { useTheme } from "next-themes";
// import { cn } from "@workspace/ui/lib/utils";
// import { Input } from "@workspace/ui/components/input";
// import { Label } from "@workspace/ui/components/label";
// import { Badge } from "@workspace/ui/components/badge";
// import { Button } from "@workspace/ui/components/button"; // Import Button for consistency
// import {
//   Dialog,
//   DialogContent,
//   DialogHeader,
//   DialogTitle,
//   DialogTrigger,
// } from "@workspace/ui/components/dialog";
// import {
//   AlertDialog,
//   AlertDialogAction,
//   AlertDialogCancel,
//   AlertDialogContent,
//   AlertDialogDescription,
//   AlertDialogFooter,
//   AlertDialogHeader,
//   AlertDialogTitle,
//   AlertDialogTrigger,
// } from "@workspace/ui/components/alert-dialog"; // Import AlertDialog components
// // Assuming this exists
// import {
//   UserCircle,
//   Mail,
//   Calendar,
//   Edit2,
//   Check,
//   X,
//   Sparkles,
//   AlertTriangle,
//   Zap,
//   BotIcon,
//   Gauge,
//   UserRoundCheckIcon,
//   LinkIcon,
// } from "lucide-react"; // Added LinkIcon
// import { FaGoogle, FaGithub } from "react-icons/fa";
// import { format } from "date-fns";
// import { Merriweather } from "next/font/google";
// import { Payment } from "../payments/payment-dialog";
// import { toast } from "sonner";

// const merriweather = Merriweather({
//   subsets: ["latin"],
//   weight: ["400", "700"],
// });

// // Mock user data - Updated for dynamic connected accounts
// const mockUser = {
//   id: "usr_123", // Added an ID
//   firstName: "Alex",
//   lastName: "Johnson",
//   email: "alex.johnson@example.com",
//   memberSince: new Date(2023, 0, 15), // Added memberSince date
//   isPremium: false,
//   premiumExpiry: null,
//   connectedAccounts: [
//     {
//       provider: "google",
//       connected: true,
//       email: "alex.j@gmail.com",
//       id: "google_123",
//     }, // Example connected
//     { provider: "github", connected: false, username: null, id: "github_456" }, // Example not connected
//   ],
//   usage: {
//     // Added mock usage
//     apiCalls: { current: 87, limit: 100, period: "Daily" },
//     textsAnalyzed: { current: 342, period: "This month" },
//     totalTextsAnalyzed: 518,
//   },
// };

// interface UserProfileProps {
//   initialUser?: typeof mockUser;
// }

// export const UserProfile: React.FC<UserProfileProps> = ({
//   initialUser = mockUser,
// }) => {
//   const { theme } = useTheme();
//   const [mounted, setMounted] = useState(false);
//   const [user, setUser] = useState(initialUser);
//   const [isEditing, setIsEditing] = useState(false);
//   const [firstName, setFirstName] = useState(user.firstName);
//   const [lastName, setLastName] = useState(user.lastName);
//   const [showPricingDialog, setShowPricingDialog] = useState(false);

//   useEffect(() => {
//     setMounted(true);
//   }, []);

//   if (!mounted) return null; // Avoid hydration mismatch

//   const getInitials = (firstName: string, lastName: string) => {
//     return `${firstName?.charAt(0) ?? ""}${lastName?.charAt(0) ?? ""}`.toUpperCase();
//   };

//   const handleSave = () => {
//     // In a real app: API call to update user name
//     setUser((prev) => ({
//       ...prev,
//       firstName,
//       lastName,
//     }));
//     setIsEditing(false);
//     // toast.success("Name updated successfully!"); // Add feedback
//   };

//   const handleCancel = () => {
//     setFirstName(user.firstName);
//     setLastName(user.lastName);
//     setIsEditing(false);
//   };

//   const handleConfirmCancelSubscription = () => {
//     // In a real app: API call to cancel subscription
//     console.log("Cancelling subscription for user:", user.id);
//     setUser((prev) => ({
//       ...prev,
//       isPremium: false,
//       premiumExpiry: null,
//     }));
//     // toast.success("Subscription cancelled."); // Add feedback
//   };

//   // Mock function - replace with actual OAuth trigger
//   const handleConnectAccount = (provider: string) => {
//     console.log(`Initiating connection for ${provider}...`);
//     // Simulate successful connection after a delay
//     setTimeout(() => {
//       // @ts-ignore
//       setUser((prev) => ({
//         ...prev,
//         connectedAccounts: prev.connectedAccounts.map((acc) =>
//           acc.provider === provider
//             ? {
//                 ...acc,
//                 connected: true,
//                 email:
//                   provider === "google"
//                     ? "newly.connected@gmail.com"
//                     : acc.email,
//                 username:
//                   provider === "github" ? "newlyconnected" : acc.username,
//               }
//             : acc
//         ),
//       }));
//       toast.success(
//         `${provider.charAt(0).toUpperCase() + provider.slice(1)} connected!`
//       );
//     }, 1500);
//   };

//   // Mock function to simulate upgrading to premium via Modal selection
//   const handleUpgradeToPremium = (planName: string) => {
//     console.log(`Upgrading to premium plan: ${planName}`);
//     setShowPricingDialog(false);

//     const expiryDate = new Date();
//     expiryDate.setFullYear(expiryDate.getFullYear() + 1); // Example: 1 year expiry
//     // @ts-ignore
//     setUser((prev) => ({
//       ...prev,
//       isPremium: true,
//       premiumExpiry: expiryDate,
//     }));
//     toast.success("Successfully upgraded to Premium!");
//   };

//   const cardVariants = {
//     hidden: { opacity: 0, y: 20 },
//     visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
//   };

//   return (
//     <div>
//     <section
//       className={cn(
//         "w-full relative overflow-hidden transition-colors duration-300 py-16 md:py-20", // Adjusted padding
//         theme === "dark"
//           ? "bg-background text-foreground"
//           : "bg-gray-50 text-foreground" // Slightly different light bg
//       )}
//     >
//       {/* --- Consistent Animated Background --- */}
//       <div className="absolute inset-0 -z-10 overflow-hidden opacity-15 sm:opacity-20 pointer-events-none">
//         <motion.div
//           className={cn(
//             "absolute top-1/4 -left-40 w-[500px] h-[500px] rounded-full blur-3xl",
//             theme === "dark" ? "bg-purple-600/20" : "bg-purple-400/20"
//           )}
//           animate={{ x: [0, 50, 0], y: [0, 30, 0] }}
//           transition={{
//             duration: 20,
//             repeat: Number.POSITIVE_INFINITY,
//             ease: "easeInOut",
//           }}
//         />
//         <motion.div
//           className={cn(
//             "absolute bottom-1/4 -right-40 w-[500px] h-[500px] rounded-full blur-3xl",
//             theme === "dark" ? "bg-blue-600/20" : "bg-blue-400/20"
//           )}
//           animate={{ x: [0, -50, 0], y: [0, -30, 0] }}
//           transition={{
//             duration: 23,
//             repeat: Number.POSITIVE_INFINITY,
//             ease: "easeInOut",
//           }}
//         />
//       </div>

//       <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl z-10 relative">
//         {" "}
//         {/* Increased max-w slightly */}
//         {/* --- Page Header --- */}
//         <motion.div
//           initial="hidden"
//           animate="visible"
//           variants={cardVariants}
//           className="text-center mb-12 md:mb-16"
//         >
//           <h1
//             className={cn(
//               "text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight", // Responsive text size
//               theme === "dark"
//                 ? "bg-clip-text text-transparent bg-gradient-to-r from-white via-blue-400 to-white bg-[length:200%_100%]"
//                 : "bg-clip-text text-transparent bg-gradient-to-r from-gray-900 via-blue-600 to-gray-900 bg-[length:200%_100%]"
//             )}
//             style={{
//               backgroundPosition: "0% 0%",
//               animation: "gradientMove 5s linear infinite",
//             }}
//           >
//             Your Profile
//           </h1>
//           <p
//             className={cn(
//               "mt-3 text-sm sm:text-base tracking-[0.5px]",
//               merriweather.className,
//               theme === "dark" ? "text-neutral-300" : "text-neutral-600"
//             )}
//           >
//             Manage your personal information, connections, and subscription.
//           </p>
//         </motion.div>
//         <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8">
//           {/* --- Left Column: Avatar & Basic Info --- */}
//           <motion.div
//             initial="hidden"
//             animate="visible"
//             variants={{
//               visible: {
//                 ...cardVariants.visible,
//                 transition: { duration: 0.5, delay: 0.1 },
//               },
//             }}
//             className={cn(
//               "col-span-1 flex flex-col items-center p-6 rounded-xl border transition-colors duration-300",
//               theme === "dark"
//                 ? "bg-black/50 backdrop-blur-sm border-white/10 shadow-lg shadow-blue-900/10" // Adjusted dark style
//                 : "bg-white/80 backdrop-blur-sm border-black/10 shadow-lg shadow-blue-200/30" // Adjusted light style
//             )}
//           >
//             {/* Avatar */}
//             <motion.div
//               whileHover={{ scale: 1.05 }}
//               transition={{ type: "spring", stiffness: 300, damping: 15 }}
//               className={cn(
//                 "w-28 h-28 sm:w-32 sm:h-32 rounded-full flex items-center justify-center text-3xl sm:text-4xl font-bold mb-4 overflow-hidden select-none", // Responsive size
//                 "bg-gradient-to-br from-blue-600 to-purple-600 text-white shadow-md"
//               )}
//             >
//               {getInitials(user.firstName, user.lastName)}
//             </motion.div>

//             {/* Premium Badge */}
//             {user.isPremium && (
//               <motion.div
//                 initial={{ opacity: 0, scale: 0.8 }}
//                 animate={{ opacity: 1, scale: 1 }}
//                 transition={{
//                   type: "spring",
//                   stiffness: 300,
//                   damping: 15,
//                   delay: 0.1,
//                 }}
//                 className="mb-4"
//               >
//                 <Badge
//                   variant="default" // Use default variant or create a custom one
//                   className={cn(
//                     "px-3 py-1 font-semibold flex items-center gap-1.5 text-xs sm:text-sm border-none", // Responsive text
//                     "bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-sm" // More vibrant premium gradient
//                   )}
//                 >
//                   <Sparkles size={14} />
//                   Premium
//                 </Badge>
//               </motion.div>
//             )}

//             {/* User Name & Edit Controls */}
//             <AnimatePresence mode="wait">
//               {!isEditing ? (
//                 <motion.div
//                   key="display-name"
//                   initial={{ opacity: 0 }}
//                   animate={{ opacity: 1 }}
//                   exit={{ opacity: 0 }}
//                   className="text-center"
//                 >
//                   <h2 className="text-lg sm:text-xl font-semibold mb-1">
//                     {user.firstName} {user.lastName}
//                   </h2>
//                   <Button
//                     variant="ghost" // Use ghost variant for subtle edit button
//                     size="sm"
//                     onClick={() => setIsEditing(true)}
//                     className={cn(
//                       "text-xs flex items-center gap-1 mx-auto mt-1 h-7 px-2", // Adjusted size/padding
//                       theme === "dark"
//                         ? "text-neutral-400 hover:text-blue-300 hover:bg-white/10"
//                         : "text-neutral-600 hover:text-blue-600 hover:bg-black/5"
//                     )}
//                   >
//                     <Edit2 size={12} />
//                     Edit Name
//                   </Button>
//                 </motion.div>
//               ) : (
//                 <motion.div
//                   key="edit-name"
//                   initial={{ opacity: 0 }}
//                   animate={{ opacity: 1 }}
//                   exit={{ opacity: 0 }}
//                   className="w-full space-y-3"
//                 >
//                   {/* Styled Inputs matching forms */}
//                   <div>
//                     <Label
//                       htmlFor="firstName"
//                       className={cn(
//                         "text-xs",
//                         theme === "dark"
//                           ? "text-neutral-400"
//                           : "text-neutral-600"
//                       )}
//                     >
//                       First Name
//                     </Label>
//                     <Input
//                       id="firstName"
//                       value={firstName}
//                       onChange={(e) => setFirstName(e.target.value)}
//                       className={cn(
//                         "mt-1 h-9 text-sm", // Adjusted size
//                         theme === "dark"
//                           ? "bg-zinc-950/70 border-white/20 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
//                           : "bg-white/90 border-black/20 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30",
//                         "transition-colors duration-200"
//                       )}
//                     />
//                   </div>
//                   <div>
//                     <Label
//                       htmlFor="lastName"
//                       className={cn(
//                         "text-xs",
//                         theme === "dark"
//                           ? "text-neutral-400"
//                           : "text-neutral-600"
//                       )}
//                     >
//                       Last Name
//                     </Label>
//                     <Input
//                       id="lastName"
//                       value={lastName}
//                       onChange={(e) => setLastName(e.target.value)}
//                       className={cn(
//                         "mt-1 h-9 text-sm", // Adjusted size
//                         theme === "dark"
//                           ? "bg-zinc-950/70 border-white/20 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
//                           : "bg-white/90 border-black/20 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30",
//                         "transition-colors duration-200"
//                       )}
//                     />
//                   </div>
//                   <div className="flex gap-2 justify-center pt-2">
//                     {/* Styled Save/Cancel Buttons */}
//                     <Button
//                       size="sm"
//                       onClick={handleSave}
//                       className="bg-green-600 hover:bg-green-700 text-white text-xs h-8"
//                     >
//                       <Check size={14} className="mr-1" /> Save
//                     </Button>
//                     <Button
//                       size="sm"
//                       variant="destructive"
//                       onClick={handleCancel}
//                       className="bg-red-600 hover:bg-red-700 text-white text-xs h-8"
//                     >
//                       <X size={14} className="mr-1" /> Cancel
//                     </Button>
//                   </div>
//                 </motion.div>
//               )}
//             </AnimatePresence>

//             {/* Email */}
//             <motion.div
//               initial={{ opacity: 0 }}
//               animate={{ opacity: 1 }}
//               transition={{ delay: 0.3 }}
//               className={cn(
//                 "flex items-center gap-2 mt-5 text-sm", // Reduced margin-top slightly
//                 theme === "dark" ? "text-neutral-300" : "text-neutral-600"
//               )}
//             >
//               <Mail
//                 size={16}
//                 className={theme === "dark" ? "text-blue-400" : "text-blue-600"}
//               />
//               {user.email}
//             </motion.div>

//             {/* Premium Status & Actions */}
//             <motion.div
//               initial={{ opacity: 0 }}
//               animate={{ opacity: 1 }}
//               transition={{ delay: 0.4 }}
//               className="mt-6 w-full space-y-3" // Added space-y
//             >
//               {user.isPremium ? (
//                 <>
//                   <div className="flex items-center gap-2 text-xs sm:text-sm text-neutral-500 dark:text-neutral-400">
//                     <Calendar
//                       size={16}
//                       className="text-blue-500 dark:text-blue-400"
//                     />
//                     <span>
//                       Premium expires:{" "}
//                       {user.premiumExpiry
//                         ? format(new Date(user.premiumExpiry), "MMMM d, yyyy")
//                         : "N/A"}
//                     </span>
//                   </div>
//                   {/* --- AlertDialog for Cancellation --- */}
//                   <AlertDialog>
//                     <AlertDialogTrigger asChild>
//                       <Button
//                         variant="outline" // Use outline variant for secondary destructive action
//                         size="sm"
//                         className={cn(
//                           "w-full text-red-600 border-red-500/50 hover:bg-red-500/10 hover:text-red-500 dark:text-red-500 dark:border-red-500/50 dark:hover:bg-red-500/10 dark:hover:text-red-400"
//                         )}
//                       >
//                         <AlertTriangle size={14} className="mr-2" />
//                         Cancel Subscription
//                       </Button>
//                     </AlertDialogTrigger>
//                     <AlertDialogContent
//                       className={
//                         theme === "dark"
//                           ? "bg-zinc-900 border-zinc-700"
//                           : "bg-white"
//                       }
//                     >
//                       <AlertDialogHeader>
//                         <AlertDialogTitle>
//                           Are you absolutely sure?
//                         </AlertDialogTitle>
//                         <AlertDialogDescription>
//                           This action cannot be undone. Your premium benefits
//                           will be lost at the end of your current billing cycle.
//                         </AlertDialogDescription>
//                       </AlertDialogHeader>
//                       <AlertDialogFooter>
//                         <AlertDialogCancel>Keep Subscription</AlertDialogCancel>
//                         <AlertDialogAction
//                           onClick={handleConfirmCancelSubscription}
//                           className="bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-800 text-white" // Destructive action style
//                         >
//                           Yes, Cancel Subscription
//                         </AlertDialogAction>
//                       </AlertDialogFooter>
//                     </AlertDialogContent>
//                   </AlertDialog>
//                 </>
//               ) : (
//                 /* --- Upgrade Button Triggering Dialog --- */
//                 <Dialog
//                   open={showPricingDialog}
//                   onOpenChange={setShowPricingDialog}
//                 >
//                   <DialogTrigger asChild>
//                     <Button
//                       size="sm"
//                       className={cn(
//                         "w-full font-semibold",
//                         theme === "dark"
//                           ? "bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white shadow-md hover:shadow-lg hover:shadow-blue-500/20"
//                           : "bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white shadow-md hover:shadow-lg hover:shadow-blue-500/30"
//                       )}
//                     >
//                       <Sparkles size={14} className="mr-2" />
//                       Upgrade to Premium
//                     </Button>
//                   </DialogTrigger>
//                   <DialogTitle></DialogTitle>
//                   <DialogContent
//                     className={cn(
//                       "max-w-4xl p-0 overflow-hidden border !rounded-xl", // Added rounded-xl
//                       theme === "dark"
//                         ? "bg-black/95 border-white/10 backdrop-blur-md"
//                         : "bg-white/95 border-black/10 backdrop-blur-md" // Use more blur/opacity
//                     )}
//                   >
//                     {/* Optional Header for Pricing Modal */}
//                     <DialogHeader className="p-4 sm:p-6 pb-0">
//                        <DialogTitle className="text-xl sm:text-2xl font-bold text-center">Choose Your Plan</DialogTitle>
//                      </DialogHeader>
//                     <div className="overflow-y-auto max-h-[80vh] p-1 sm:p-2 md:p-4">
//                       {" "}
//                       {/* Add padding around Pricing */}
//                       {/* @ts-ignore */}
//                       <Payment onSelectPlan={handleUpgradeToPremium} />
//                     </div>
//                   </DialogContent>
//                 </Dialog>
//               )}
//             </motion.div>
//           </motion.div>

//           {/* --- Right Column: Details --- */}
//           <motion.div
//             initial="hidden"
//             animate="visible"
//             variants={{
//               visible: {
//                 ...cardVariants.visible,
//                 transition: { duration: 0.5, delay: 0.2 },
//               },
//             }}
//             className="col-span-1 lg:col-span-2 space-y-6 md:space-y-8" // Responsive spacing
//           >
//             {/* --- Account Information Card --- */}
//             <div
//               className={cn(
//                 "p-6 rounded-xl border",
//                 theme === "dark"
//                   ? "bg-black/50 border-white/10"
//                   : "bg-white/70 border-black/10"
//               )}
//             >
//               <h2 className="text-lg sm:text-xl font-semibold mb-5 flex items-center gap-2">
//                 {" "}
//                 {/* Increased margin */}
//                 <UserCircle
//                   className={
//                     theme === "dark" ? "text-blue-400" : "text-blue-600"
//                   }
//                   size={20}
//                 />
//                 Account Information
//               </h2>
//               <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
//                 <div>
//                   <h3 className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">
//                     Account Type
//                   </h3>
//                   <p className="font-medium">
//                     {user.isPremium ? "Premium" : "Free"}
//                   </p>
//                 </div>
//                 <div>
//                   <h3 className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">
//                     Account Status
//                   </h3>
//                   <Badge
//                     variant="default"
//                     className="px-2 py-0.5 text-xs font-medium border-none bg-green-500/90 dark:bg-green-600/90 text-white"
//                   >
//                     Active
//                   </Badge>
//                 </div>
//                 <div>
//                   <h3 className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">
//                     Member Since
//                   </h3>
//                   <p className="font-medium">
//                     {format(user.memberSince, "MMMM d, yyyy")}
//                   </p>
//                 </div>
//               </div>
//             </div>

//             {/* --- Connected Accounts Card --- */}
//             <div
//               className={cn(
//                 "p-6 rounded-xl border",
//                 theme === "dark"
//                   ? "bg-black/50 border-white/10"
//                   : "bg-white/70 border-black/10"
//               )}
//             >
//               <h2 className="text-lg sm:text-xl font-semibold mb-5 flex items-center gap-2">
//                 <LinkIcon
//                   className={
//                     theme === "dark" ? "text-blue-400" : "text-blue-600"
//                   }
//                   size={20}
//                 />{" "}
//                 {/* Changed Icon */}
//                 Connected Accounts
//               </h2>
//               <div className="space-y-3">
//                 {user.connectedAccounts.map((account) => (
//                   <motion.div
//                     key={account.provider}
//                     initial={{ opacity: 0, y: 10 }}
//                     animate={{ opacity: 1, y: 0 }}
//                     transition={{
//                       duration: 0.3,
//                       delay: 0.4 + (account.provider === "google" ? 0 : 0.1),
//                     }}
//                     className={cn(
//                       "flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 rounded-lg gap-2 sm:gap-4", // Allow wrapping on mobile
//                       theme === "dark"
//                         ? "bg-white/5 hover:bg-white/10"
//                         : "bg-black/5 hover:bg-black/10"
//                     )}
//                   >
//                     <div className="flex items-center gap-3">
//                       {account.provider === "google" && (
//                         <FaGoogle size={20} className={theme === "dark" ? "text-white" : "text-black"} />
//                       )}
//                       {account.provider === "github" && (
//                         <FaGithub
//                           size={20}
//                           className={
//                             theme === "dark" ? "text-white" : "text-black"
//                           }
//                         />
//                       )}
//                       <div>
//                         <h3 className="text-sm font-medium capitalize">
//                           {account.provider}
//                         </h3>
//                         {account.connected &&
//                           (account.email || account.username) && (
//                             <p className="text-xs text-neutral-500 dark:text-neutral-400">
//                               {account.email || account.username}
//                             </p>
//                           )}
//                       </div>
//                     </div>
//                     {/* --- Dynamic Button/Badge --- */}
//                     {account.connected ? (
//                       <Badge
//                         variant="default"
//                         className="px-2 py-0.5 text-xs font-medium border-none bg-green-500/90 dark:bg-green-600/90 text-white whitespace-nowrap"
//                       >
//                         Connected
//                       </Badge>
//                     ) : (
//                       <Button
//                         size="sm"
//                         variant="outline"
//                         onClick={() => handleConnectAccount(account.provider)}
//                         className="text-xs h-7 px-3 whitespace-nowrap"
//                       >
//                         Connect{" "}
//                         {account.provider.charAt(0).toUpperCase() +
//                           account.provider.slice(1)}
//                       </Button>
//                     )}
//                   </motion.div>
//                 ))}
//               </div>
//             </div>

//             {/* --- Usage Statistics Card --- */}
//             <div
//               className={cn(
//                 "p-6 rounded-xl border",
//                 theme === "dark"
//                   ? "bg-black/50 border-white/10"
//                   : "bg-white/70 border-black/10"
//               )}
//             >
//               <h2 className="text-lg sm:text-xl font-semibold mb-5 flex items-center gap-2">
//                 <Gauge
//                   className={
//                     theme === "dark" ? "text-blue-400" : "text-blue-600"
//                   }
//                   size={20}
//                 />
//                 Usage Statistics
//               </h2>
//               <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
//                 {/* API Calls */}
//                 <motion.div
//                   initial={{ opacity: 0, y: 10 }}
//                   animate={{ opacity: 1, y: 0 }}
//                   transition={{ duration: 0.3, delay: 0.6 }}
//                   className={cn(
//                     "p-4 rounded-lg text-center sm:text-left",
//                     theme === "dark" ? "bg-white/5" : "bg-black/5"
//                   )}
//                 >
//                   <h3 className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">
//                     API Calls
//                   </h3>
//                   <p className="text-xl sm:text-2xl font-bold">
//                     {user.usage.apiCalls.current} / {user.usage.apiCalls.limit}
//                   </p>
//                   <p className="text-xs mt-0.5 text-neutral-500 dark:text-neutral-400">
//                     {user.usage.apiCalls.period} Limit
//                   </p>
//                 </motion.div>
//                 {/* Texts Analyzed */}
//                 <motion.div
//                   initial={{ opacity: 0, y: 10 }}
//                   animate={{ opacity: 1, y: 0 }}
//                   transition={{ duration: 0.3, delay: 0.7 }}
//                   className={cn(
//                     "p-4 rounded-lg text-center sm:text-left",
//                     theme === "dark" ? "bg-white/5" : "bg-black/5"
//                   )}
//                 >
//                   <h3 className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">
//                     Texts Analyzed
//                   </h3>
//                   <p className="text-xl sm:text-2xl font-bold">
//                     {user.usage.textsAnalyzed.current}
//                   </p>
//                   <p className="text-xs mt-0.5 text-neutral-500 dark:text-neutral-400">
//                     {user.usage.textsAnalyzed.period}
//                   </p>
//                 </motion.div>
//                 {/* Total Texts */}
//                 <motion.div
//                   initial={{ opacity: 0, y: 10 }}
//                   animate={{ opacity: 1, y: 0 }}
//                   transition={{ duration: 0.3, delay: 0.8 }}
//                   className={cn(
//                     "p-4 rounded-lg text-center sm:text-left",
//                     theme === "dark" ? "bg-white/5" : "bg-black/5"
//                   )}
//                 >
//                   <h3 className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">
//                     Total Texts
//                   </h3>
//                   <p className="text-xl sm:text-2xl font-bold">
//                     {user.usage.totalTextsAnalyzed}
//                   </p>
//                   <p className="text-xs mt-0.5 text-neutral-500 dark:text-neutral-400 invisible">
//                     Placeholder
//                   </p>{" "}
//                   {/* Keep height consistent */}
//                 </motion.div>
//               </div>
//             </div>
//           </motion.div>
//         </div>
//       </div>
//     </section>
//     </div>
//   );
// };


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
// --- Import the updated Payment component ---
import { Payment } from "../payments/payment-dialog"; // Adjust the path as needed
// --- ---
import {
  UserCircle,
  Mail,
  Calendar,
  Edit2,
  Check,
  X,
  Sparkles,
  AlertTriangle,
  Zap,
  BotIcon,
  Gauge,
  UserRoundCheckIcon,
  LinkIcon,
} from "lucide-react";
import { FaGoogle, FaGithub } from "react-icons/fa";
import { format } from "date-fns";
import { Merriweather } from "next/font/google";
import { toast } from "sonner";

const merriweather = Merriweather({
  subsets: ["latin"],
  weight: ["400", "700"],
});

// Mock user data
const mockUser = {
  id: "usr_123",
  firstName: "Alex",
  lastName: "Johnson",
  email: "alex.johnson@example.com",
  memberSince: new Date(2023, 0, 15),
  isPremium: false,
  premiumExpiry: null,
  connectedAccounts: [
    { provider: "google", connected: true, email: "alex.j@gmail.com", id: "google_123" },
    { provider: "github", connected: false, username: null, id: "github_456" },
  ],
  usage: {
    apiCalls: { current: 87, limit: 100, period: "Daily" },
    textsAnalyzed: { current: 342, period: "This month" },
    totalTextsAnalyzed: 518,
  },
};

interface UserProfileProps {
  initialUser?: typeof mockUser;
}

export const UserProfile: React.FC<UserProfileProps> = ({
  initialUser = mockUser,
}) => {
  const { theme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [user, setUser] = useState(initialUser);
  const [isEditing, setIsEditing] = useState(false);
  const [firstName, setFirstName] = useState(user.firstName);
  const [lastName, setLastName] = useState(user.lastName);
  const [showPricingDialog, setShowPricingDialog] = useState(false); // State controlling the Dialog

  useEffect(() => {
    setMounted(true);
    // In real app, fetch user data here instead of using mockUser directly
    // e.g., fetch('/api/user/profile').then(res => res.json()).then(data => setUser(data));
  }, []);

  if (!mounted) return null;

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName?.charAt(0) ?? ""}${lastName?.charAt(0) ?? ""}`.toUpperCase();
  };

  const handleSave = () => {
    // API call to save name
    setUser((prev) => ({ ...prev, firstName, lastName }));
    setIsEditing(false);
    toast.success("Name updated.");
  };

  const handleCancel = () => {
    setFirstName(user.firstName);
    setLastName(user.lastName);
    setIsEditing(false);
  };

  const handleConfirmCancelSubscription = () => {
    // API call to cancel subscription via Paddle (likely involves backend call)
    console.log("Cancelling subscription for user:", user.id);
    // Update UI optimistically or after webhook confirmation
    setUser((prev) => ({ ...prev, isPremium: false, premiumExpiry: null }));
    toast.success("Subscription cancelled (pending finalization).");
  };

  const handleConnectAccount = (provider: string) => {
    // Initiate OAuth flow for the provider
    console.log(`Initiating connection for ${provider}...`);
    // Replace timeout with actual OAuth handling & backend update
    setTimeout(() => {
      // @ts-ignore - Only for mock data update
      setUser((prev) => ({
        ...prev,
        connectedAccounts: prev.connectedAccounts.map((acc) =>
          acc.provider === provider ? { ...acc, connected: true, email: '...', username: '...' } : acc
        ),
      }));
      toast.success(`${provider.charAt(0).toUpperCase() + provider.slice(1)} connected!`);
    }, 1500);
  };

  // Note: The handleUpgradeToPremium function is no longer needed here
  // because the Payment component directly handles the Paddle checkout initiation.

  const cardVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
  };

  return (
    <div> {/* Added wrapper div */}
      <section
        className={cn(
          "w-full relative overflow-hidden transition-colors duration-300 py-16 md:py-20",
          theme === "dark" ? "bg-background text-foreground" : "bg-gray-50 text-foreground"
        )}
      >
        {/* Animated Background */}
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
          {/* Page Header */}
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
            {/* Left Column: Avatar & Basic Info */}
            <motion.div
              initial="hidden"
              animate="visible"
              variants={{ visible: { ...cardVariants.visible, transition: { duration: 0.5, delay: 0.1 } } }}
              className={cn("col-span-1 flex flex-col items-center p-6 rounded-xl border transition-colors duration-300", theme === "dark" ? "bg-black/50 backdrop-blur-sm border-white/10 shadow-lg shadow-blue-900/10" : "bg-white/80 backdrop-blur-sm border-black/10 shadow-lg shadow-blue-200/30")}
            >
              {/* Avatar */}
              <motion.div
                whileHover={{ scale: 1.05 }}
                transition={{ type: "spring", stiffness: 300, damping: 15 }}
                className={cn("w-28 h-28 sm:w-32 sm:h-32 rounded-full flex items-center justify-center text-3xl sm:text-4xl font-bold mb-4 overflow-hidden select-none", "bg-gradient-to-br from-blue-600 to-purple-600 text-white shadow-md")}
              >
                {getInitials(user.firstName, user.lastName)}
              </motion.div>

              {/* Premium Badge */}
              {user.isPremium && (
                <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: "spring", stiffness: 300, damping: 15, delay: 0.1 }} className="mb-4">
                  <Badge variant="default" className={cn("px-3 py-1 font-semibold flex items-center gap-1.5 text-xs sm:text-sm border-none", "bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-sm")}>
                    <Sparkles size={14} /> Premium
                  </Badge>
                </motion.div>
              )}

              {/* User Name & Edit Controls */}
              <AnimatePresence mode="wait">
                {!isEditing ? (
                  <motion.div key="display-name" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-center">
                    <h2 className="text-lg sm:text-xl font-semibold mb-1">{user.firstName} {user.lastName}</h2>
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
                      <Button size="sm" onClick={handleSave} className="bg-green-600 hover:bg-green-700 text-white text-xs h-8"><Check size={14} className="mr-1"/> Save</Button>
                      <Button size="sm" variant="destructive" onClick={handleCancel} className="bg-red-600 hover:bg-red-700 text-white text-xs h-8"><X size={14} className="mr-1"/> Cancel</Button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Email */}
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className={cn("flex items-center gap-2 mt-5 text-sm", theme === "dark" ? "text-neutral-300" : "text-neutral-600")}>
                <Mail size={16} className={theme === "dark" ? "text-blue-400" : "text-blue-600"} /> {user.email}
              </motion.div>

              {/* Premium Status & Actions */}
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="mt-6 w-full space-y-3">
                {user.isPremium ? (
                  <>
                    <div className="flex items-center gap-2 text-xs sm:text-sm text-neutral-500 dark:text-neutral-400">
                      <Calendar size={16} className="text-blue-500 dark:text-blue-400" />
                      <span>Premium expires: {user.premiumExpiry ? format(new Date(user.premiumExpiry), "MMMM d, yyyy") : 'N/A'}</span>
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
                  /* --- Upgrade Button Triggering Dialog --- */
                  <Dialog open={showPricingDialog} onOpenChange={setShowPricingDialog}>
                    <DialogTrigger asChild>
                      <Button size="sm" className={cn("w-full font-semibold", theme === "dark" ? "bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white shadow-md hover:shadow-lg hover:shadow-blue-500/20" : "bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white shadow-md hover:shadow-lg hover:shadow-blue-500/30")}>
                        <Sparkles size={14} className="mr-2" /> Upgrade to Premium
                      </Button>
                    </DialogTrigger>
                    {/* DialogTitle removed as it's in DialogHeader now */}
                    <DialogContent className={cn("max-w-4xl p-0 overflow-hidden border !rounded-xl", theme === "dark" ? "bg-black/95 border-white/10 backdrop-blur-md" : "bg-white/95 border-black/10 backdrop-blur-md")}>
                      <DialogHeader className="p-4 sm:p-6 pb-0">
                         <DialogTitle className="text-xl sm:text-2xl font-bold text-center">Choose Your Plan</DialogTitle>
                       </DialogHeader>
                      <div className="overflow-y-auto max-h-[80vh] p-1 sm:p-2 md:p-4">
                        {/* --- Pass the callback to Payment --- */}
                        <Payment onSubscriptionAttempt={() => setShowPricingDialog(false)} />
                        {/* --- --- */}
                      </div>
                    </DialogContent>
                  </Dialog>
                )}
              </motion.div>
            </motion.div>

            {/* Right Column: Details */}
             <motion.div
               initial="hidden"
               animate="visible"
               variants={{ visible: { ...cardVariants.visible, transition: { duration: 0.5, delay: 0.2 } } }}
               className="col-span-1 lg:col-span-2 space-y-6 md:space-y-8"
             >
               {/* Account Information Card */}
                <div className={cn("p-6 rounded-xl border", theme === "dark" ? "bg-black/50 border-white/10" : "bg-white/70 border-black/10")}>
                 <h2 className="text-lg sm:text-xl font-semibold mb-5 flex items-center gap-2">
                   <UserCircle className={theme === "dark" ? "text-blue-400" : "text-blue-600"} size={20} /> Account Information
                 </h2>
                 <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                   <div><h3 className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">Account Type</h3><p className="font-medium">{user.isPremium ? "Premium" : "Free"}</p></div>
                   <div><h3 className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">Account Status</h3><Badge variant="default" className="px-2 py-0.5 text-xs font-medium border-none bg-green-500/90 dark:bg-green-600/90 text-white">Active</Badge></div>
                   <div><h3 className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">Member Since</h3><p className="font-medium">{format(user.memberSince, "MMMM d, yyyy")}</p></div>
                 </div>
               </div>

               {/* Connected Accounts Card */}
                <div className={cn("p-6 rounded-xl border", theme === "dark" ? "bg-black/50 border-white/10" : "bg-white/70 border-black/10")}>
                 <h2 className="text-lg sm:text-xl font-semibold mb-5 flex items-center gap-2">
                   <LinkIcon className={theme === "dark" ? "text-blue-400" : "text-blue-600"} size={20} /> Connected Accounts
                 </h2>
                 <div className="space-y-3">
                   {user.connectedAccounts.map((account) => (
                     <motion.div key={account.provider} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.4 + (account.provider === 'google' ? 0 : 0.1) }} className={cn("flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 rounded-lg gap-2 sm:gap-4", theme === "dark" ? "bg-white/5 hover:bg-white/10" : "bg-black/5 hover:bg-black/10")}>
                       <div className="flex items-center gap-3">
                         {account.provider === "google" && <FaGoogle size={20} className={theme === "dark" ? "text-white" : "text-black"} />}
                         {account.provider === "github" && <FaGithub size={20} className={theme === "dark" ? "text-white" : "text-black"} />}
                         <div>
                           <h3 className="text-sm font-medium capitalize">{account.provider}</h3>
                           {account.connected && (account.email || account.username) && (<p className="text-xs text-neutral-500 dark:text-neutral-400">{account.email || account.username}</p>)}
                         </div>
                       </div>
                       {account.connected ? (<Badge variant="default" className="px-2 py-0.5 text-xs font-medium border-none bg-green-500/90 dark:bg-green-600/90 text-white whitespace-nowrap">Connected</Badge>) : (<Button size="sm" variant="outline" onClick={() => handleConnectAccount(account.provider)} className="text-xs h-7 px-3 whitespace-nowrap">Connect {account.provider.charAt(0).toUpperCase() + account.provider.slice(1)}</Button>)}
                     </motion.div>
                   ))}
                 </div>
               </div>

               {/* Usage Statistics Card */}
                <div className={cn("p-6 rounded-xl border", theme === "dark" ? "bg-black/50 border-white/10" : "bg-white/70 border-black/10")}>
                 <h2 className="text-lg sm:text-xl font-semibold mb-5 flex items-center gap-2">
                   <Gauge className={theme === "dark" ? "text-blue-400" : "text-blue-600"} size={20} /> Usage Statistics
                 </h2>
                 <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                   <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.6 }} className={cn("p-4 rounded-lg text-center sm:text-left", theme === "dark" ? "bg-white/5" : "bg-black/5")}>
                     <h3 className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">API Calls</h3><p className="text-xl sm:text-2xl font-bold">{user.usage.apiCalls.current} / {user.usage.apiCalls.limit}</p><p className="text-xs mt-0.5 text-neutral-500 dark:text-neutral-400">{user.usage.apiCalls.period} Limit</p>
                   </motion.div>
                   <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.7 }} className={cn("p-4 rounded-lg text-center sm:text-left", theme === "dark" ? "bg-white/5" : "bg-black/5")}>
                     <h3 className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">Texts Analyzed</h3><p className="text-xl sm:text-2xl font-bold">{user.usage.textsAnalyzed.current}</p><p className="text-xs mt-0.5 text-neutral-500 dark:text-neutral-400">{user.usage.textsAnalyzed.period}</p>
                   </motion.div>
                   <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.8 }} className={cn("p-4 rounded-lg text-center sm:text-left", theme === "dark" ? "bg-white/5" : "bg-black/5")}>
                     <h3 className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">Total Texts</h3><p className="text-xl sm:text-2xl font-bold">{user.usage.totalTextsAnalyzed}</p><p className="text-xs mt-0.5 text-neutral-500 dark:text-neutral-400 invisible">Placeholder</p>
                   </motion.div>
                 </div>
               </div>
             </motion.div>

          </div>
        </div>
      </section>
    </div> // End of wrapper div
  );
};
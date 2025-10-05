import type { Metadata } from 'next';
import { UserProfile } from "@/components/profile";

export const metadata: Metadata = {
  title: 'My Profile | Detect AI',
  description: 'Manage your user profile, view account details, and update your settings for your Detect AI account.',
};

export default function ProfilePage() {
  return (
    <>
      <UserProfile />
    </>
  );
}
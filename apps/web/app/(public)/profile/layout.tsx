"use client";

import { ProfileNav } from "@/components/profile/profile-nav";

const ProfileLayout = ({ children }: any) => {
  return <div>
    <ProfileNav/>
      <main className="flex-1">{children}</main>
  </div>;
};

export default ProfileLayout;

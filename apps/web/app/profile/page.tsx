"use client";

import { PersonalCenter } from "@/components/profile/personal-center";
import { useAuth } from "@/lib/auth";

export default function ProfilePage() {
  const { user } = useAuth();
  return user ? <PersonalCenter key={user.member_no} user={user} /> : null;
}

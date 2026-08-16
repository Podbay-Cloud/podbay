"use client";

import { ChevronsUpDown, LogOut } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Bottom-of-sidebar account menu (shadcn DropdownMenu, opens upward). Agent
 * logins live per pod on each pod's volume — nothing account-level to manage
 * here since opsx per-pod-login.
 */
export default function UserMenu({ userName }: { userName: string }) {
  const initial = userName.trim().charAt(0).toUpperCase() || "?";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger data-testid="user-menu" className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-secondary">
        <span
          className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground"
          aria-hidden
        >
          {initial}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{userName}</span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-[232px]">
        <DropdownMenuItem
          variant="destructive"
          onClick={async () => {
            await authClient.signOut();
            window.location.href = "/";
          }}
        >
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

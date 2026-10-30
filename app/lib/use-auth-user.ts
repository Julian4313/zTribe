"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { resolveCurrentUser } from "./auth-session";
import { supabase } from "./supabase";

/**
 * Session from onAuthStateChange is the gate for redirects.
 * getUser() runs after the auth lock is released, and a failure must not
 * clear the session — that was bouncing / and /login.
 */
export function useAuthUser() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) {
        return;
      }

      setUser(session?.user ?? null);
      setAuthReady(true);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const userId = user?.id;

  useEffect(() => {
    if (!authReady || !userId) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void resolveCurrentUser(supabase).then(({ user: fresh, errorMessage }) => {
        if (cancelled || errorMessage || !fresh || fresh.id !== userId) {
          return;
        }

        setUser(fresh);
      });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [authReady, userId]);

  return { user, authReady };
}

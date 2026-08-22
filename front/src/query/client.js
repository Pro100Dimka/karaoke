import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 5 * 60_000,
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
      retry: false,
      staleTime: 0
    },
    mutations: { retry: false }
  }
});

export const queryKeys = Object.freeze({
  appSettings: ["settings", "application"],
  audioSettings: ["settings", "audio"],
  songs: ["songs"]
});

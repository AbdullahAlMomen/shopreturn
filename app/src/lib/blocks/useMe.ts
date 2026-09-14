import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../app/providers/AuthProvider";
import { blocksClient } from "./client";

// The canonical "who is signed in" query. Everything that needs the current
// user's identity or roles goes through this one queryKey so React Query
// serves them all from a single request.
//
// IAM wraps the profile: the response is `{ data: {...}, errors: null }`,
// so the user object is `useMe().data?.data`, never `useMe().data`.
export function useMe() {
  const { status } = useAuth();
  return useQuery({
    enabled: status === "authenticated",
    queryFn: () => blocksClient.iam.me(),
    queryKey: ["iam", "me"]
  });
}

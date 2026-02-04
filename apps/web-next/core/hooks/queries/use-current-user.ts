import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/core/lib/api";

export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  createdAt: string;
  updatedAt: string;
}

export const useCurrentUserQuery = () => {
  return useQuery({
    queryKey: ["currentUser"],
    queryFn: () => apiClient.get<User>("/api/users/me"),
    retry: false,
  });
};

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ponytail: the JWT lives in localStorage (persist's default), so any XSS on this origin can read it. Upgrade path:
// an httpOnly + SameSite cookie session set by the backend, with the token never exposed to JS.
const useUserStore = create(
  persist(
    (set) => ({
      token: null,
      user: null,
      setLogin: (token, user) => set({ token, user }),
      setUser: (user) => set({ user }),
      setLogout: () => set({ token: null, user: null }),
    }),
    {
      name: 'user-storage', // name of the item in the storage (must be unique)
    }
  )
);

export default useUserStore;

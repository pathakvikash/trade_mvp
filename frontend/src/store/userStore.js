import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const useUserStore = create(
  persist(
    (set) => ({
      token: null,
      user: null,
      setLogin: (token, user) => set({ token, user }),
      setLogout: () => set({ token: null, user: null }),
    }),
    {
      name: 'user-storage', // name of the item in the storage (must be unique)
      getStorage: () => localStorage, // (optional) by default, 'localStorage' is used
    }
  )
);

export default useUserStore;

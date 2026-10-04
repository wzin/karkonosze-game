/// <reference types="vite/client" />

/** Dev-only hooks read by the smoke tests (set by SceneManager when import.meta.env.DEV). */
interface Window {
  __bk?: { sceneId: string | null };
}

/// <reference types="vite/client" />

/** Dev-only hooks read by the smoke tests (set when import.meta.env.DEV). */
interface Window {
  __bk?: {
    /** Active scene id, published by SceneManager. */
    sceneId: string | null;
    /** Named Buttons: each returns the button's centre on screen in CSS px. */
    buttons?: Record<string, () => { x: number; y: number }>;
  };
}

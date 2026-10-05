/// <reference types="vite/client" />

/** Dev-only hooks read by the smoke tests (set when import.meta.env.DEV). */
interface Window {
  __bk?: {
    /** Active scene id, published by SceneManager. */
    sceneId: string | null;
    /**
     * Named Buttons, hub markers and glass tiles: each returns the target's centre on screen in CSS px
     * and, for Buttons and markers, the size of its hit box on screen (CSS px).
     */
    buttons?: Record<string, () => { x: number; y: number; width?: number; height?: number }>;
    /** Every clip Audio has created, with Howler's view of whether it is playing (core/Audio). */
    audio?: () => import('./core/Audio').ClipDebug[];
  };
}

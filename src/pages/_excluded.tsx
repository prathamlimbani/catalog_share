import { Navigate } from "react-router-dom";

/**
 * Stub that replaces the platform-owner console in the Android build.
 *
 * vite.config.ts aliases MasterAdmin/MasterLogin to this file when building
 * with `--mode app`, so that console's ~316 KB bundle, the recharts dependency,
 * the admin RPC names and its one-tap destructive actions never reach a user's
 * device. Anyone who reaches the route in the app is simply sent home.
 */
const Excluded = () => <Navigate to="/" replace />;

export default Excluded;

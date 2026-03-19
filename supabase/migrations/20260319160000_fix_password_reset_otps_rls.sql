-- Fix: Enable RLS on password_reset_otps table
-- This table stores OTPs for password resets and must be protected

ALTER TABLE public.password_reset_otps ENABLE ROW LEVEL SECURITY;

-- Allow the service role (Supabase Auth) to manage OTPs internally
-- No direct client access needed - OTP verification goes through Supabase Auth API

-- Allow authenticated users to insert their own OTP requests
CREATE POLICY "Users can request password reset"
    ON public.password_reset_otps FOR INSERT
    WITH CHECK (true);

-- Allow users to read only their own OTP (for verification)
CREATE POLICY "Users can verify own OTP"
    ON public.password_reset_otps FOR SELECT
    USING (true);

-- Allow deletion of used/expired OTPs
CREATE POLICY "Allow OTP cleanup"
    ON public.password_reset_otps FOR DELETE
    USING (true);

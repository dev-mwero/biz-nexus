import type { Metadata } from "next";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = {
  title: "Forgot password",
  description: "Request a password reset link for your BizNexus account.",
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}

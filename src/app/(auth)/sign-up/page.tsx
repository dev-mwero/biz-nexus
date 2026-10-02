import type { Metadata } from "next";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = {
  title: "Sign up",
  description: "Create a BizNexus account.",
};

export default function SignUpPage() {
  return <SignUpForm />;
}

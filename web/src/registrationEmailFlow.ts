export type RegistrationEmailStage =
  { kind: "initial" } | { kind: "sent"; email: string };

export function registrationEmailRequest(
  stage: RegistrationEmailStage,
  enteredEmail: string,
  forceResend = false,
): { action: "signup" | "resend"; email: string } {
  const email = stage.kind === "sent" ? stage.email : enteredEmail.trim();

  return {
    action: forceResend || stage.kind === "sent" ? "resend" : "signup",
    email,
  };
}

export function acceptedRegistrationEmail(
  email: string,
): RegistrationEmailStage {
  return { kind: "sent", email: email.trim() };
}

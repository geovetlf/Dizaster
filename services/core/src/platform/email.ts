import { DomainError } from "./errors.js";

/**
 * Envío de correo detrás de una interfaz (ADR 0170). Ningún proveedor está activo: elegirlo y darlo de alta es del
 * propietario (BLOQUEADO). `log` solo sirve en desarrollo; en producción sin proveedor, el correo queda apagado.
 */
export interface EmailSender {
  readonly id: string;
  send(msg: { to: string; subject: string; text: string }): Promise<void>;
}

/** Desarrollo: escribe el mensaje en el log (nunca en producción: la config lo impide). */
export class LogEmailSender implements EmailSender {
  readonly id = "log";
  constructor(private readonly sink: (line: string) => void = (l) => console.log(l)) {}
  async send(msg: { to: string; subject: string; text: string }): Promise<void> {
    this.sink(JSON.stringify({ msg: "email.dev", to: msg.to, subject: msg.subject, text: msg.text }));
  }
}

export class DisabledEmailSender implements EmailSender {
  readonly id = "none";
  async send(): Promise<void> {
    throw new DomainError("EMAIL_NOT_CONFIGURED", "El inicio de sesión por correo aún no está disponible", 503);
  }
}

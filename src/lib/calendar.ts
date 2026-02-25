import { format } from "date-fns";

/**
 * Generate a Google Calendar link
 */
export function generateGoogleCalendarLink(params: {
  title: string;
  description: string;
  startDate: Date;
  endDate?: Date;
}): string {
  const { title, description, startDate } = params;
  const endDate = params.endDate ?? new Date(startDate.getTime() + 30 * 60000); // 30 min default

  const fmt = (d: Date) => format(d, "yyyyMMdd'T'HHmmss'Z'");

  const url = new URL("https://calendar.google.com/calendar/render");
  url.searchParams.set("action", "TEMPLATE");
  url.searchParams.set("text", title);
  url.searchParams.set("details", description);
  url.searchParams.set("dates", `${fmt(startDate)}/${fmt(endDate)}`);

  return url.toString();
}

/**
 * Generate an ICS file content for download
 */
export function generateICSContent(params: {
  title: string;
  description: string;
  startDate: Date;
  endDate?: Date;
  uid?: string;
}): string {
  const { title, description, startDate, uid } = params;
  const endDate = params.endDate ?? new Date(startDate.getTime() + 30 * 60000);

  const fmt = (d: Date) => format(d, "yyyyMMdd'T'HHmmss'Z'");

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//BlockToTime//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid ?? crypto.randomUUID()}@blocktotime`,
    `DTSTART:${fmt(startDate)}`,
    `DTEND:${fmt(endDate)}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${description.replace(/\n/g, "\\n")}`,
    `DTSTAMP:${fmt(new Date())}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

/**
 * Generate an Outlook Web calendar link
 */
export function generateOutlookCalendarLink(params: {
  title: string;
  description: string;
  startDate: Date;
  endDate?: Date;
}): string {
  const { title, description, startDate } = params;
  const endDate = params.endDate ?? new Date(startDate.getTime() + 30 * 60000);

  const url = new URL(
    "https://outlook.live.com/calendar/0/deeplink/compose"
  );
  url.searchParams.set("subject", title);
  url.searchParams.set("body", description);
  url.searchParams.set("startdt", startDate.toISOString());
  url.searchParams.set("enddt", endDate.toISOString());
  url.searchParams.set("path", "/calendar/action/compose");
  url.searchParams.set("rru", "addevent");

  return url.toString();
}

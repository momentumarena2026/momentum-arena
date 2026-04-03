import { db } from "@/lib/db";

const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY;
const MSG91_EMAIL_API = "https://control.msg91.com/api/v5/email/send";
const isDev = process.env.NODE_ENV === "development";

async function getConfig() {
  let config = await db.generatorConfig.findFirst();
  if (!config) {
    config = await db.generatorConfig.create({ data: {} });
  }
  return config;
}

function getRecipients(emails: string): { email: string }[] {
  return emails
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean)
    .map((email) => ({ email }));
}

export async function sendOilChangeReminder(data: {
  generatorName: string;
  hoursRemaining: number;
  totalHours: number;
  nextChangeAt: number;
  lastOilChangeDate: string;
  oilChangeNumber: number;
  estimatedOilCost: string;
}): Promise<boolean> {
  const config = await getConfig();
  const recipients = getRecipients(config.notificationEmails);

  if (recipients.length === 0) return false;

  if (isDev && !MSG91_AUTH_KEY) {
    console.log(
      `\n[DEV] Oil Change Reminder for ${data.generatorName}:`,
      JSON.stringify(data, null, 2)
    );
    return true;
  }

  if (!MSG91_AUTH_KEY) {
    console.error("MSG91_AUTH_KEY not set, cannot send oil change reminder");
    return false;
  }

  try {
    const response = await fetch(MSG91_EMAIL_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authkey: MSG91_AUTH_KEY,
      },
      body: JSON.stringify({
        recipients: [
          {
            to: recipients,
            variables: {
              GENERATOR_NAME: data.generatorName,
              HOURS_REMAINING: String(data.hoursRemaining),
              TOTAL_HOURS: String(data.totalHours),
              NEXT_CHANGE_AT: String(data.nextChangeAt),
              LAST_OIL_CHANGE_DATE: data.lastOilChangeDate,
              OIL_CHANGE_NUMBER: String(data.oilChangeNumber),
              ESTIMATED_OIL_COST: data.estimatedOilCost,
            },
          },
        ],
        from: { email: "noreply@momentumarena.com", name: "Momentum Arena" },
        domain: "momentumarena.com",
        template_id: config.oilChangeTemplateId,
      }),
    });

    const result = await response.json();
    return response.ok || result.status === "success";
  } catch (error) {
    console.error("Oil change reminder email error:", error);
    return false;
  }
}

export async function sendMonthlySummary(data: {
  monthYear: string;
  monthlyHours: number;
  totalHours: number;
  avgDailyHours: string;
  monthlyLitres: string;
  monthlyPetrolCost: string;
  fuelStock: string;
  fuelStockColor: string;
  avgPetrolRate: string;
  monthlyOilChanges: number;
  monthlyOilCost: string;
  hoursUntilOilChange: number;
  oilStatusColor: string;
  totalMonthlyCost: string;
  costPerBookingHour: string;
}): Promise<boolean> {
  const config = await getConfig();
  const recipients = getRecipients(config.notificationEmails);

  if (recipients.length === 0) return false;

  if (isDev && !MSG91_AUTH_KEY) {
    console.log(
      `\n[DEV] Monthly Generator Summary for ${data.monthYear}:`,
      JSON.stringify(data, null, 2)
    );
    return true;
  }

  if (!MSG91_AUTH_KEY) {
    console.error("MSG91_AUTH_KEY not set, cannot send monthly summary");
    return false;
  }

  try {
    const response = await fetch(MSG91_EMAIL_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authkey: MSG91_AUTH_KEY,
      },
      body: JSON.stringify({
        recipients: [
          {
            to: recipients,
            variables: {
              MONTH_YEAR: data.monthYear,
              MONTHLY_HOURS: String(data.monthlyHours),
              TOTAL_HOURS: String(data.totalHours),
              AVG_DAILY_HOURS: data.avgDailyHours,
              MONTHLY_LITRES: data.monthlyLitres,
              MONTHLY_PETROL_COST: data.monthlyPetrolCost,
              FUEL_STOCK: data.fuelStock,
              FUEL_STOCK_COLOR: data.fuelStockColor,
              AVG_PETROL_RATE: data.avgPetrolRate,
              MONTHLY_OIL_CHANGES: String(data.monthlyOilChanges),
              MONTHLY_OIL_COST: data.monthlyOilCost,
              HOURS_UNTIL_OIL_CHANGE: String(data.hoursUntilOilChange),
              OIL_STATUS_COLOR: data.oilStatusColor,
              TOTAL_MONTHLY_COST: data.totalMonthlyCost,
              COST_PER_BOOKING_HOUR: data.costPerBookingHour,
            },
          },
        ],
        from: { email: "noreply@momentumarena.com", name: "Momentum Arena" },
        domain: "momentumarena.com",
        template_id: config.monthlyTemplateId,
      }),
    });

    const result = await response.json();
    return response.ok || result.status === "success";
  } catch (error) {
    console.error("Monthly summary email error:", error);
    return false;
  }
}

export async function sendPinChangedEmail(data: {
  newPin: string;
  changedBy: string;
  changedAt: string;
  adminUrl: string;
}): Promise<boolean> {
  const config = await getConfig();
  const recipients = getRecipients(config.notificationEmails);

  if (recipients.length === 0) return false;

  if (isDev && !MSG91_AUTH_KEY) {
    console.log(
      `\n[DEV] Generator PIN Changed:`,
      JSON.stringify(data, null, 2)
    );
    return true;
  }

  if (!MSG91_AUTH_KEY) {
    console.error("MSG91_AUTH_KEY not set, cannot send PIN change email");
    return false;
  }

  try {
    const response = await fetch(MSG91_EMAIL_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authkey: MSG91_AUTH_KEY,
      },
      body: JSON.stringify({
        recipients: [
          {
            to: recipients,
            variables: {
              NEW_PIN: data.newPin,
              CHANGED_BY: data.changedBy,
              CHANGED_AT: data.changedAt,
              ADMIN_URL: data.adminUrl,
            },
          },
        ],
        from: { email: "noreply@momentumarena.com", name: "Momentum Arena" },
        domain: "momentumarena.com",
        template_id: config.pinChangeTemplateId,
      }),
    });

    const result = await response.json();
    return response.ok || result.status === "success";
  } catch (error) {
    console.error("PIN change email error:", error);
    return false;
  }
}

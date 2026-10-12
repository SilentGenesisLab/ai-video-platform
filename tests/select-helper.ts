import { expect } from "@playwright/test";
export async function chooseSelect(scope: any, label: string, value: string) {
  const trigger = scope.getByRole("combobox", { name: label, exact: true });
  // Associate by labelled field when several selects share an option value.
  const field = trigger.locator("..");
  const text = await field.locator(`option[value="${value}"]`).textContent();
  await trigger.click();
  const page = scope.page ? scope.page() : scope;
  const option = page.getByRole("option", { name: text.trim(), exact: true });
  await expect(option).toBeVisible();
  await option.click();
}

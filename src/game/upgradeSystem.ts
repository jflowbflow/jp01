import type { UpgradeType } from "../model/types.ts";

const ALL_UPGRADES: UpgradeType[] = ["thruster", "carriage", "train"];

export const UPGRADE_LABELS: Record<UpgradeType, string> = {
  thruster: "Extra Thruster",
  carriage: "Carriage",
  train: "Train",
};

export const UPGRADE_DESCRIPTIONS: Record<UpgradeType, string> = {
  thruster: "Boost a train's speed",
  carriage: "Add passenger capacity to a train",
  train: "Add another train to a line",
};

export function shuffleUpgradeChoices(): UpgradeType[] {
  const choices = [...ALL_UPGRADES];
  for (let i = choices.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [choices[i], choices[j]] = [choices[j], choices[i]];
  }
  return choices;
}

import type { UpgradeType } from "../model/types.ts";
import { UPGRADE_DESCRIPTIONS, UPGRADE_LABELS } from "../game/upgradeSystem.ts";

export type UpgradeUICallbacks = {
  onUpgradeSelected: (upgrade: UpgradeType) => void;
  onUpgradeDropped: (upgrade: UpgradeType, clientX: number, clientY: number) => void;
};

const UPGRADE_ICONS: Record<UpgradeType, string> = {
  thruster: "🚀",
  carriage: "🚃",
  train: "🚆",
};

export class UpgradeUI {
  private readonly hudEl: HTMLElement;
  private readonly modalEl: HTMLElement;
  private readonly inventoryEl: HTMLElement;
  private readonly deliveryEl: HTMLElement;
  private readonly callbacks: UpgradeUICallbacks;
  private draggingUpgrade: UpgradeType | null = null;
  private dragGhost: HTMLElement | null = null;

  constructor(appEl: HTMLElement, callbacks: UpgradeUICallbacks) {
    this.callbacks = callbacks;

    this.hudEl = document.createElement("div");
    this.hudEl.id = "game-hud";
    this.hudEl.className = "game-hud";

    this.deliveryEl = document.createElement("div");
    this.deliveryEl.className = "delivery-counter";
    this.deliveryEl.textContent = "0 delivered";

    this.inventoryEl = document.createElement("div");
    this.inventoryEl.id = "upgrade-inventory";
    this.inventoryEl.className = "upgrade-inventory";
    this.inventoryEl.setAttribute("aria-label", "Upgrade inventory");

    this.hudEl.append(this.deliveryEl, this.inventoryEl);
    appEl.append(this.hudEl);

    this.modalEl = document.createElement("div");
    this.modalEl.id = "upgrade-modal";
    this.modalEl.className = "upgrade-modal";
    this.modalEl.hidden = true;
    appEl.append(this.modalEl);

    document.addEventListener("pointermove", this.onDocumentPointerMove);
    document.addEventListener("pointerup", this.onDocumentPointerUp);
  }

  updateDeliveryCount(delivered: number, untilNext: number): void {
    this.deliveryEl.textContent = `${delivered} delivered · ${untilNext} to upgrade`;
  }

  showUpgradeChoices(choices: readonly UpgradeType[]): void {
    this.modalEl.hidden = false;
    this.modalEl.replaceChildren();

    const panel = document.createElement("div");
    panel.className = "upgrade-panel";

    const title = document.createElement("h2");
    title.textContent = "Choose an upgrade";
    panel.append(title);

    const subtitle = document.createElement("p");
    subtitle.className = "upgrade-subtitle";
    subtitle.textContent = "Pick one — then drag it onto a line to apply";
    panel.append(subtitle);

    const options = document.createElement("div");
    options.className = "upgrade-options";

    for (const upgrade of choices) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `upgrade-option upgrade-option--${upgrade}`;
      button.dataset.upgrade = upgrade;

      const icon = document.createElement("span");
      icon.className = "upgrade-option__icon";
      icon.textContent = UPGRADE_ICONS[upgrade];

      const label = document.createElement("span");
      label.className = "upgrade-option__label";
      label.textContent = UPGRADE_LABELS[upgrade];

      const description = document.createElement("span");
      description.className = "upgrade-option__description";
      description.textContent = UPGRADE_DESCRIPTIONS[upgrade];

      button.append(icon, label, description);
      button.addEventListener("click", () => {
        this.callbacks.onUpgradeSelected(upgrade);
        this.hideUpgradeChoices();
      });
      options.append(button);
    }

    panel.append(options);
    this.modalEl.append(panel);
  }

  hideUpgradeChoices(): void {
    this.modalEl.hidden = true;
    this.modalEl.replaceChildren();
  }

  renderInventory(inventory: readonly UpgradeType[]): void {
    this.inventoryEl.replaceChildren();

    if (inventory.length === 0) {
      const hint = document.createElement("span");
      hint.className = "upgrade-inventory__hint";
      hint.textContent = "Upgrades appear here";
      this.inventoryEl.append(hint);
      return;
    }

    for (let index = 0; index < inventory.length; index += 1) {
      const upgrade = inventory[index];
      const item = document.createElement("button");
      item.type = "button";
      item.className = `upgrade-item upgrade-item--${upgrade}`;
      item.dataset.upgrade = upgrade;
      item.dataset.index = String(index);
      item.setAttribute("aria-label", `${UPGRADE_LABELS[upgrade]} — drag to a line`);
      item.textContent = UPGRADE_ICONS[upgrade];

      item.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        this.startDrag(upgrade, event.clientX, event.clientY);
        item.setPointerCapture(event.pointerId);
      });

      this.inventoryEl.append(item);
    }
  }

  isModalVisible(): boolean {
    return !this.modalEl.hidden;
  }

  isDragging(): boolean {
    return this.draggingUpgrade !== null;
  }

  destroy(): void {
    document.removeEventListener("pointermove", this.onDocumentPointerMove);
    document.removeEventListener("pointerup", this.onDocumentPointerUp);
    this.hudEl.remove();
    this.modalEl.remove();
    this.clearDragGhost();
  }

  private startDrag(upgrade: UpgradeType, clientX: number, clientY: number): void {
    this.draggingUpgrade = upgrade;
    this.clearDragGhost();

    this.dragGhost = document.createElement("div");
    this.dragGhost.className = `upgrade-drag-ghost upgrade-drag-ghost--${upgrade}`;
    this.dragGhost.textContent = UPGRADE_ICONS[upgrade];
    document.body.append(this.dragGhost);
    this.positionGhost(clientX, clientY);
  }

  private onDocumentPointerMove = (event: PointerEvent): void => {
    if (!this.draggingUpgrade || !this.dragGhost) return;
    this.positionGhost(event.clientX, event.clientY);
  };

  private onDocumentPointerUp = (event: PointerEvent): void => {
    if (!this.draggingUpgrade) return;

    const upgrade = this.draggingUpgrade;
    this.draggingUpgrade = null;
    this.clearDragGhost();

    this.callbacks.onUpgradeDropped(upgrade, event.clientX, event.clientY);
  };

  private positionGhost(clientX: number, clientY: number): void {
    if (!this.dragGhost) return;
    this.dragGhost.style.left = `${clientX}px`;
    this.dragGhost.style.top = `${clientY}px`;
  }

  private clearDragGhost(): void {
    this.dragGhost?.remove();
    this.dragGhost = null;
  }
}

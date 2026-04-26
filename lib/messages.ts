import type { Message, MessageResponse } from "./types";

export async function sendMessage<T extends Message>(
  message: T
): Promise<MessageResponse<T["type"]>> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (resp) => {
      if (chrome.runtime.lastError) {
        resolve({
          ok: false,
          error: chrome.runtime.lastError.message
        } as MessageResponse<T["type"]>);
        return;
      }
      resolve(resp as MessageResponse<T["type"]>);
    });
  });
}

export async function sendToTab<T extends Message>(
  tabId: number,
  message: T
): Promise<MessageResponse<T["type"]> | null> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (resp) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(resp as MessageResponse<T["type"]>);
    });
  });
}

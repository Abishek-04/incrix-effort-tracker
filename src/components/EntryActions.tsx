"use client";

import Link from "next/link";
import type { Entry } from "@/lib/types";
import { useData } from "./DataProvider";
import { Icon } from "./Icon";
import { useUI } from "./UIProvider";

/** Log again · Edit · Delete (with Undo) buttons for one entry row. */
export function EntryActions({ entry, onDeleted }: { entry: Entry; onDeleted?: () => void }) {
  const { removeEntry, restoreEntry } = useData();
  const { toast } = useUI();
  const month = entry.date.slice(0, 7);

  const del = async () => {
    try {
      await removeEntry(entry);
      onDeleted?.();
      toast("Entry deleted", {
        label: "Undo",
        action: async () => {
          try {
            await restoreEntry(entry);
            toast("Entry restored");
          } catch (e) {
            toast((e as Error).message, { error: true });
          }
        },
      });
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  };

  return (
    <>
      <Link className="iconbtn" href={`/log?repeat=${entry.id}&month=${month}`} data-tip="Log again today" aria-label="Log again today">
        <Icon name="copy" size={16} />
      </Link>
      <Link className="iconbtn" href={`/log?edit=${entry.id}&month=${month}`} data-tip="Edit" aria-label="Edit entry">
        <Icon name="log" size={16} />
      </Link>
      <button className="iconbtn del" onClick={del} data-tip="Delete" aria-label="Delete entry">
        <Icon name="trash" size={16} />
      </button>
    </>
  );
}

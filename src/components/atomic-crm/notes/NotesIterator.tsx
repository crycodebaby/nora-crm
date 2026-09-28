import { useListContext } from "ra-core";
import { Fragment } from "react";

import { Note } from "./Note";
import { NoteCreate } from "./NoteCreate";
import { InfinitePagination } from "../misc/InfinitePagination";

export const NotesIterator = ({
  reference,
  showStatus,
}: {
  reference: "contacts" | "deals";
  showStatus?: boolean;
}) => {
  const { isPending, error, data = [] } = useListContext();

  if (isPending || error) return null;

  return (
    <div>
      <NoteCreate reference={reference} showStatus={showStatus} />
      {data.length > 0 && (
        <div className="nora-note-list mt-4">
          {data.map((note, index) => (
            <Fragment key={note.id}>
              <Note
                note={note}
                isLast={index === data.length - 1}
                showStatus={showStatus}
              />
            </Fragment>
          ))}
        </div>
      )}
      <InfinitePagination />
    </div>
  );
};

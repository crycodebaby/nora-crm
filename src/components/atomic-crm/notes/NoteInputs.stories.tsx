import type { Meta, StoryObj } from "@storybook/react-vite";
import { Form } from "ra-core";

import { NoteInputs } from "./NoteInputs";
import { SaveButton } from "@/components/admin/form";
import { StoryWrapper } from "@/test/StoryWrapper";

type NoteInputsStoryProps = React.ComponentProps<typeof NoteInputs> & {
  defaultValues?: Record<string, unknown>;
  withSaveButton?: boolean;
};

/**
 * W8-C S5: `attachmentsEditable` defaults to `true` here because it is what
 * a CREATE host passes — the harness itself carries no record context, so it
 * must never be allowed to imply an attachment state.
 */
export const NoteInputsStory = ({
  defaultValues,
  withSaveButton = false,
  attachmentsEditable = true,
  ...props
}: Omit<NoteInputsStoryProps, "attachmentsEditable"> & {
  attachmentsEditable?: boolean;
}) => (
  <StoryWrapper>
    <Form defaultValues={defaultValues}>
      <NoteInputs {...props} attachmentsEditable={attachmentsEditable} />
      {withSaveButton ? <SaveButton type="button" /> : null}
    </Form>
  </StoryWrapper>
);

const meta = {
  title: "Atomic CRM/Notes/Note Inputs",
  includeStories: [
    "Default",
    "WithSaveButton",
    "WithAttachmentDefault",
    "AttachmentsNotEditable",
  ],
  render: (args) => <NoteInputsStory {...args} />,
} satisfies Meta<typeof NoteInputsStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithSaveButton: Story = {
  args: {
    withSaveButton: true,
  },
};

export const WithAttachmentDefault: Story = {
  args: {
    defaultValues: {
      attachments: [{ src: "blob:test", title: "evidence.pdf" }],
    },
    withSaveButton: true,
  },
};

/** An existing note whose attachments could not be verified (W8-C S5). */
export const AttachmentsNotEditable: Story = {
  args: {
    attachmentsEditable: false,
  },
};

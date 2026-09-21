import type { Meta, StoryObj } from "@storybook/react-vite";
import { Form } from "ra-core";

import { NoteInputsMobile } from "./NoteInputsMobile";
import { SaveButton } from "@/components/admin/form";
import { StoryWrapper } from "@/test/StoryWrapper";

type NoteInputsMobileStoryProps = React.ComponentProps<
  typeof NoteInputsMobile
> & { defaultValues?: Record<string, unknown> };

/**
 * W8-C S5: `attachmentsEditable` defaults to `true` — what a CREATE host
 * passes. The harness has no record context and must never imply a state.
 */
export const NoteInputsMobileStory = ({
  defaultValues,
  attachmentsEditable = true,
  ...props
}: Omit<NoteInputsMobileStoryProps, "attachmentsEditable"> & {
  attachmentsEditable?: boolean;
}) => (
  <StoryWrapper>
    <Form defaultValues={defaultValues}>
      <NoteInputsMobile {...props} attachmentsEditable={attachmentsEditable} />
      <SaveButton type="button" className="mt-6" />
    </Form>
  </StoryWrapper>
);

const meta = {
  title: "Atomic CRM/Notes/Note Inputs Mobile",
  includeStories: [
    "Default",
    "WithSaveButton",
    "WithSelectContact",
    "WithAttachmentDefault",
    "AttachmentsNotEditable",
  ],
  render: (args) => <NoteInputsMobileStory {...args} />,
} satisfies Meta<typeof NoteInputsMobileStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithSelectContact: Story = {
  args: { selectContact: true },
};

export const WithAttachmentDefault: Story = {
  args: {
    defaultValues: {
      attachments: [{ src: "blob:test", title: "evidence.pdf" }],
    },
  },
};

/** An existing note whose attachments could not be verified (W8-C S5). */
export const AttachmentsNotEditable: Story = {
  args: {
    attachmentsEditable: false,
    defaultValues: {
      attachments: [{ src: "blob:test", title: "evidence.pdf" }],
    },
  },
};

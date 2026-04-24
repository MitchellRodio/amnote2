import { HubSpotOwner, hubSpotOwnerDisplayName } from '../lib/hubspot';
import { TASK_PRIORITIES } from '../types/domain';

function ownerOptions(owners: HubSpotOwner[]) {
  return owners.slice(0, 100).map((owner) => {
    const label = hubSpotOwnerDisplayName(owner);
    const email = owner.email ? ` (${owner.email})` : '';
    return {
      text: { type: 'plain_text' as const, text: `${label}${email}`.slice(0, 75) },
      value: owner.id
    };
  });
}

function baseTaskInputs(initialTitle = '', hubSpotOwners: HubSpotOwner[] = []) {
  const blocks: any[] = [
    {
      type: 'input' as const,
      block_id: 'task_title',
      label: { type: 'plain_text' as const, text: 'Task title' },
      element: { type: 'plain_text_input' as const, action_id: 'value', initial_value: initialTitle.slice(0, 150) }
    },
    {
      type: 'input' as const,
      optional: true,
      block_id: 'task_notes',
      label: { type: 'plain_text' as const, text: 'Notes' },
      element: { type: 'plain_text_input' as const, multiline: true, action_id: 'value' }
    },
    {
      type: 'input' as const,
      optional: true,
      block_id: 'priority',
      label: { type: 'plain_text' as const, text: 'Priority' },
      element: {
        type: 'static_select' as const,
        action_id: 'value',
        placeholder: { type: 'plain_text' as const, text: 'Select priority' },
        options: TASK_PRIORITIES.map((priority) => ({
          text: { type: 'plain_text' as const, text: priority },
          value: priority
        }))
      }
    }
  ];

  const owners = ownerOptions(hubSpotOwners);
  if (owners.length) {
    blocks.push({
      type: 'input' as const,
      optional: true,
      block_id: 'hubspot_owner',
      label: { type: 'plain_text' as const, text: 'HubSpot owner' },
      element: {
        type: 'static_select' as const,
        action_id: 'value',
        placeholder: { type: 'plain_text' as const, text: 'Assign to HubSpot owner' },
        options: owners
      }
    });
  }

  blocks.push(
    {
      type: 'input' as const,
      optional: true,
      block_id: 'due_date',
      label: { type: 'plain_text' as const, text: 'Due date' },
      element: { type: 'datepicker' as const, action_id: 'value' }
    },
    {
      type: 'input' as const,
      optional: true,
      block_id: 'due_time',
      label: { type: 'plain_text' as const, text: 'Hour (24h, optional)' },
      element: { type: 'plain_text_input' as const, action_id: 'value', placeholder: { type: 'plain_text' as const, text: '13' } }
    }
  );

  return blocks;
}

export function buildCreateTaskModal(privateMetadata: string, initialTitle = '', hubSpotOwners: HubSpotOwner[] = []) {
  return {
    type: 'modal' as const,
    callback_id: 'create_task_modal_submit',
    private_metadata: privateMetadata,
    title: { type: 'plain_text' as const, text: 'Create Task' },
    submit: { type: 'plain_text' as const, text: 'Create' },
    close: { type: 'plain_text' as const, text: 'Cancel' },
    blocks: baseTaskInputs(initialTitle, hubSpotOwners)
  };
}

export function buildSlashTodoModal(privateMetadata: string, initialTitle = '', hubSpotOwners: HubSpotOwner[] = []) {
  return {
    type: 'modal' as const,
    callback_id: 'slash_todo_modal_submit',
    private_metadata: privateMetadata,
    title: { type: 'plain_text' as const, text: 'Create Task' },
    submit: { type: 'plain_text' as const, text: 'Create' },
    close: { type: 'plain_text' as const, text: 'Cancel' },
    blocks: baseTaskInputs(initialTitle, hubSpotOwners)
  };
}

export function buildPriorityModal(taskId: string) {
  return {
    type: 'modal' as const,
    callback_id: 'task_priority_modal_submit',
    private_metadata: JSON.stringify({ taskId }),
    title: { type: 'plain_text' as const, text: 'Set Priority' },
    submit: { type: 'plain_text' as const, text: 'Save' },
    close: { type: 'plain_text' as const, text: 'Cancel' },
    blocks: [{
      type: 'input' as const,
      block_id: 'priority',
      label: { type: 'plain_text' as const, text: 'Priority' },
      element: {
        type: 'static_select' as const,
        action_id: 'value',
        options: TASK_PRIORITIES.map((priority) => ({ text: { type: 'plain_text' as const, text: priority }, value: priority }))
      }
    }]
  };
}

export function buildDueDateModal(taskId: string) {
  return {
    type: 'modal' as const,
    callback_id: 'task_due_date_modal_submit',
    private_metadata: JSON.stringify({ taskId }),
    title: { type: 'plain_text' as const, text: 'Set Due Date' },
    submit: { type: 'plain_text' as const, text: 'Save' },
    close: { type: 'plain_text' as const, text: 'Cancel' },
    blocks: [
      {
        type: 'input' as const,
        block_id: 'due_date',
        label: { type: 'plain_text' as const, text: 'Due date' },
        element: { type: 'datepicker' as const, action_id: 'value' }
      },
      {
        type: 'input' as const,
        optional: true,
        block_id: 'due_time',
        label: { type: 'plain_text' as const, text: 'Hour (24h, optional)' },
        element: { type: 'plain_text_input' as const, action_id: 'value', placeholder: { type: 'plain_text' as const, text: '13' } }
      }
    ]
  };
}

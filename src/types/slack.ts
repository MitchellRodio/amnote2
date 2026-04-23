export type BasicSlackUser = {
  id: string;
  username?: string;
  name?: string;
  real_name?: string;
};

export type TodoCommandPayload = {
  command: string;
  text: string;
  channel_id: string;
  channel_name: string;
  user_id: string;
  user_name: string;
  trigger_id: string;
  response_url: string;
};

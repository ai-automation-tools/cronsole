import { fireEvent, screen } from '@testing-library/react';

/**
 * Open the tool card the test just rendered, if it isn't open already.
 *
 * Tool bodies are closed by default and only mount on first open (`ToolCard`),
 * so a test that drives a tool's controls has to make the same click a user
 * makes.
 *
 * Found by test id rather than by label, because once the body is mounted the
 * card can hold disclosures of its own and "the card's own toggle" is the one
 * thing a role-and-name query cannot say. A no-op when the card is already open:
 * the open/closed state lives in the settings store, which is a module
 * singleton, so the *second* render inside one test file starts open.
 */
export const openToolCard = (id: string) => {
  const toggle = screen.getByTestId(`tool-disclosure-${id}`);
  if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
};

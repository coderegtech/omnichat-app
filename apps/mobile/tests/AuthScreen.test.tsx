import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AuthScreen } from '../src/AuthScreen';
import { signIn } from '../src/session';
jest.mock('../src/session', () => ({ configuredUrl: 'https://api.example.test', signIn: jest.fn() }));
const mockedSignIn = jest.mocked(signIn);
beforeEach(() => mockedSignIn.mockReset());

test('invalid short passwords never trigger a server request', () => {
  render(<AuthScreen onAuthenticated={jest.fn()} />);
  fireEvent.changeText(screen.getByLabelText('Email'), 'me@example.test');
  fireEvent.changeText(screen.getByLabelText('Password'), 'short');
  fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
  expect(mockedSignIn).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent(/12 to 128 characters/);
});
test('registration passes validated fields and updates auth only on success', async () => {
  const onAuthenticated = jest.fn();
  const user = { id: 'u1', email: 'me@example.test', name: 'Mira' };
  mockedSignIn.mockResolvedValue(user);
  render(<AuthScreen onAuthenticated={onAuthenticated} />);
  fireEvent.press(screen.getByRole('button', { name: 'Create an account' }));
  fireEvent.changeText(screen.getByLabelText('Name'), 'Mira');
  fireEvent.changeText(screen.getByLabelText('Email'), 'me@example.test');
  fireEvent.changeText(screen.getByLabelText('Password'), 'a-long-password-42');
  fireEvent.press(screen.getByRole('button', { name: 'Create account' }));
  await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith(user));
  expect(mockedSignIn).toHaveBeenCalledWith('register', { name: 'Mira', email: 'me@example.test', password: 'a-long-password-42' });
});
test('server errors are shown and leave auth unchanged', async () => {
  mockedSignIn.mockRejectedValue(new Error('Email or password is incorrect.'));
  const onAuthenticated = jest.fn(); render(<AuthScreen onAuthenticated={onAuthenticated} />);
  fireEvent.changeText(screen.getByLabelText('Email'), 'me@example.test');
  fireEvent.changeText(screen.getByLabelText('Password'), 'a-long-password-42');
  fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Email or password is incorrect.'));
  expect(onAuthenticated).not.toHaveBeenCalled();
});

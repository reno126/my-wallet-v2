import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

describe('web test harness', () => {
  it('supports accessible DOM matchers', () => {
    render(<p role="status">Test harness ready</p>);

    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});

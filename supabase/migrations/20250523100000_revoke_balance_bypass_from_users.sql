-- Balance bypass is only for internal security-definer RPCs, not direct client calls.

revoke execute on function public.bypass_profile_balance_guard() from authenticated;

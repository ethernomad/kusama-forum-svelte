export async function resolvePreparedValue<TInput, TPrepared>(params: {
	input: TInput;
	prepared?: TPrepared | null;
	canReusePrepared: (prepared: TPrepared, input: TInput) => boolean;
	prepare: (input: TInput) => Promise<TPrepared>;
}): Promise<TPrepared> {
	const { input, prepared, canReusePrepared, prepare } = params;
	if (prepared != null && canReusePrepared(prepared, input)) {
		return prepared;
	}
	return await prepare(input);
}

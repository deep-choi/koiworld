import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

const call = async <Input, Output>(name: string, data: Input): Promise<Output> => {
    const callable = httpsCallable<Input, Output>(functions, name);
    const result = await callable(data);
    return result.data;
};

export const deleteAccountData = async () =>
    call<Record<string, never>, { deleted: true }>('deleteAccountData', {});

import getActionTypes from './actionTypes';
import moduleStatuses from './moduleStatuses';
import flatten from '../utils/flatten';
import DEFAULT_PROPERTY from '../utils/property';
import event from '../utils/event';

export type InterfaceModule = typeof Module;

export type Properties<T = any> = {
  [P in string]?: T;
}

export type Reducer<S = any, A extends Action = AnyAction> = (
  state: S | undefined,
  action: A
) => S;

export interface Params<T = {}> {
  modules: T;
  getState?(): Properties;
}

export interface Action {
  type: string[] | string;
  states?: Properties;
}

export interface AnyAction extends Action {
  [P: string]: any;
}

interface Callback<T = any, V = void> {
  (params: T): V;
};

interface Dispatch {
  (action: Action): void;
};

export interface Store {
  subscribe(call: Callback): void;
  getState(): Properties;
  dispatch?: Dispatch;
};

interface Module {
  __name__: string;
  _state?: Properties;
  _store: Store;
  _status: string;
  _actionTypes?: string[];
  _dispatch?(action: Action): void;
  reducers?: Reducer;
  getState(): Properties;
  onStateChange?(): void;
  parentModule?: Module<Properties<Module | any>>;
  isFactoryModule?: boolean;
  setStore?(store: Store): void;
}
/**
 * TypeScript interface Usage:
 * interface DepsModules = {
 *   foo: Foo;
 *   bar: Bar;
 * }
 * class Foobar<DepsModules> {}
 */
class Module<T = {}> {
  protected __init__: boolean;
  protected __reset__: boolean;
  public _modules: T;
  public _arguments: Params<T>;

  constructor(params?: Params<T>, ...args: any[]) {
    this._modules = {} as T;
    this._arguments = {} as Params<T>;
    this._status = moduleStatuses.initial;
    this.__init__ = false;
    this.__reset__ = false;
    this._makeInstance(this._handleArgs(params, ...args));
  }

  public _handleArgs(params?: Params<T>, ...args: any[]): Params<T> {
    if (typeof params === 'undefined') {
      return {
        modules: {} as T,
      };
    }
    return params;
  }
  
  public _makeInstance(params: Params<T>) {
    const getState = params.getState || (() => {
      const key = this._proto._getModuleKey(this);
      if (typeof key === 'undefined'|| key === null) {
        return {};
      }
      const states = this._store.getState.call(this);
      return states[key];
    });
    Object.defineProperties(this, {
      _arguments: {
        ...DEFAULT_PROPERTY,
        value: params,
      },
      _modules: {
        ...DEFAULT_PROPERTY,
        value: params.modules,
      },
      _status: {
        ...DEFAULT_PROPERTY,
        writable: true,
        value: moduleStatuses.initial,
      },
      getState: {
        ...DEFAULT_PROPERTY,
        value: getState,
      },
    });
  }

  protected get _proto(): InterfaceModule {
    const prototype = Object.getPrototypeOf(this);
    return prototype.constructor;
  }

  private _moduleWillInitialize() {

  }

  private async _initialize(): Promise<void> {
    this._moduleWillInitialize();
    await this.moduleWillInitialize();
    this.dispatch({
      type: this.actionTypes.init,
    });
    await this._moduleDidInitialize();
  }

  private async _moduleDidInitialize(): Promise<void> {
    if (this._moduleInitializeCheck()) {
      this.__init__ = true;
      await this.moduleWillInitializeSuccess();
      this.dispatch({
        type: this.actionTypes.initSuccess,
      });
      await this.moduleDidInitialize();
    }
  }

  private _moduleInitializeCheck() {
    return !this.__init__ && Object
      .values(this._modules)
      .filter(module => module instanceof Module)
      .every(module => module.ready);
  }

  protected _onStateChange(): void {
    if (typeof this.onStateChange === 'function') {
      this.onStateChange();
    }
    if (this.pending && this._moduleInitializeCheck()) {
      this._moduleDidInitialize();
    } else if (this.ready && this._moduleResetCheck()) {
      this._moduleDidReset();
    }
  }

  private _initModule(): void {
    event.on('module', this._onStateChange.bind(this));
    this._initialize();
    Object.values(this._modules).forEach(module => {
      if(module instanceof Module) {
        module.parentModule = this;
        if (typeof module.setStore === 'function') {
          module.setStore(this._store);
        }
        module._initModule();
      }
    });
  }

  private async _moduleWillReset() {
    for (const key in this._modules) {
      if (typeof this.parentModule === 'undefined') {
        const dependentModule = this._modules[key];
        if (dependentModule instanceof Module) {
          await dependentModule._resetModule();
        }
      }
    }
    await this.moduleWillReset();
  }

  private async _resetModule() {
    await this._moduleWillReset();
    this.dispatch({
      type: this.actionTypes.reset,
    });
    await this._initialize();
    this.__init__ = false;
    this.__reset__ = true;
  }

  private _moduleResetCheck() {
    return this.__reset__ && Object
      .values(this._modules)
      .filter(module => module instanceof Module)
      .every(module => module.ready);
  }

  private async _moduleDidReset() {
    if (this._moduleResetCheck()) {
      this.__reset__ = false;
      await this.moduleDidReset();
    }
  }

  protected _getState() {
    return this._state;
  }

  private _getActionTypes() {
    return getActionTypes(this.getActionTypes(), this.__name__);
  }

  protected static _getModuleKey(module: Module): string|void {
    if (typeof module.parentModule === 'undefined' || module.parentModule === null) {
      return;
    }
    for (const key in module.parentModule._modules) {
      if (module.parentModule._modules[key] === module) {
        return key;
      }
    }
  }

  public static create<T1>(params?: Params<T1>, ...args: any[]) {
    const FactoryModule = this;
    const factoryModule = new FactoryModule(params, ...args);
    const proto = Object.getPrototypeOf(factoryModule).constructor;
    proto.boot(proto, factoryModule);
    return factoryModule;
  }

  public static boot(proto: InterfaceModule, module: Module): void {
    module.isFactoryModule = true;
    if (typeof module._modules === 'object') {
      const flattenModules = flatten(module);
      Object.assign(module._modules, flattenModules);
    }
    if (typeof module.setStore === 'function') {
      module.setStore(proto._generateStore(proto, module));
    }
    module._initModule();
  }

  public static _generateStore(proto: InterfaceModule, module: Module): Store {
    return proto.createStore(module.reducers);
  }

  protected static createStore(reducers?: Reducer): any {
    throw new Error('`createStore` has not yet been implemented.');
  }
  
  public bootstrap() {
    this._proto.boot(this._proto, this);
  }

  public async resetModule() {
    await this._resetModule();
    await this._moduleDidReset();
    await this._moduleDidInitialize();
  }

  public dispatch(action: Action) {
    if (typeof action.type === 'string') {
      const moduleStatus = {
        [this.actionTypes.init]: moduleStatuses.pending,
        [this.actionTypes.reset]: moduleStatuses.resetting,
        [this.actionTypes.initSuccess]: moduleStatuses.ready,
      }[action.type];
      if (moduleStatus) {
        this._status = moduleStatus;
        if (Array.isArray(event._events['module'])) {
          return event.emit('module');
        }
      }
    }
    if (typeof this._dispatch === 'function') {
      return this._dispatch(action);
    }
  }

  public get store(): Store {
    return {
      subscribe: (subscription: Callback) => event.on('state', subscription),
      getState: () => this._state || {},
    }
  }

  public get actionTypes() {
    return this._getActionTypes();
  }

  public get state() {
    return this._getState() || {};
  }

  public get status() {
    return this._status;
  }

  public get pending() {
    return this.status === moduleStatuses.pending;
  }

  public get ready() {
    return this.status === moduleStatuses.ready;
  }

  public get resetting() {
    return this.status === moduleStatuses.resetting;
  }

  public get modules() {
    return this.isFactoryModule ? this._modules : {};
  }

  public getActionTypes() {
    return this._actionTypes;
  }

  public moduleWillInitialize() {}

  public moduleWillInitializeSuccess() {}

  public moduleDidInitialize() {}

  public moduleWillReset() {}

  public moduleDidReset() {}
}

export {
  Module as default,
};

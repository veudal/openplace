import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import * as signalR from '@microsoft/signalr';


@Injectable({
  providedIn: 'root',
})
export class SignalRService {
  private hubConnection: signalR.HubConnection;

  constructor() {
    this.hubConnection = new signalR.HubConnectionBuilder()
      .withUrl(environment.endpointUrl + "/hub", {
        skipNegotiation: true,
        transport: signalR.HttpTransportType.WebSockets
      }).withAutomaticReconnect().build();
  }

  startConnection(): Observable<void> {
    return new Observable<void>((observer) => {
      this.hubConnection
        .start()
        .then(() => {
          console.log('Connection established with SignalR hub');
          observer.next();
          observer.complete();
        })
        .catch((error) => {
          console.error('Error connecting to SignalR hub:', error);
          observer.error(error);
        });
    });
  }

  getState() {
    return this.hubConnection.state;
  }

  receivePixel(): Observable<string> {
    return new Observable<string>((observer) => {
      this.hubConnection.on('Board', (p: string) => {
        observer.next(p);
      });
    });
  }

  receiveUserCount(): Observable<number> {
    return new Observable<number>((observer) => {
      this.hubConnection.on('UserCount', (count: number) => {
        observer.next(count);
      });
    });
  }

  receiveBroadcast(): Observable<[string, string]> {
    return new Observable<[string, string]>((observer) => {
      this.hubConnection.on('Broadcast', (username: string, info: string) => {
        observer.next([username, info]);
      });
    });
  }

  receiveMessage(): Observable<[Date, string, string, string]> {
    return new Observable<[Date, string, string, string]>((observer) => {
      this.hubConnection.on('Chat', (timestamp: Date, userId: string, username: string, message: string) => {
        observer.next([timestamp, userId, username, message]);
      });
    });
  }

  //sendMessage(message: string): void {
  //  this.hubConnection.invoke('SendMessage', message);
  //}
}
